import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { makeEnvelope } from "./envelope.js";

// WebChat チャネル: プロトタイプのメインUI。
// Messenger 風の画面でチームと会話し、絵文字リアクションと
// マルチスレッドを試せる。

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, "..", "..", "web");

export class WebChatChannel {
  constructor({ team, store, port = 8787, host = "127.0.0.1", basicUser = null, basicPassword = null } = {}) {
    this.team = team;
    this.store = store;
    this.port = port;
    this.host = host;
    this.basicUser = basicUser ?? process.env.VISIONONE_BASIC_USER ?? null;
    this.basicPassword = basicPassword ?? process.env.VISIONONE_BASIC_PASSWORD ?? null;
    this.server = null;
  }

  get name() {
    return "webchat";
  }

  async start() {
    this.server = createServer((req, res) => this.route(req, res));
    await new Promise((resolve) => this.server.listen(this.port, this.host, resolve));
    const addr = this.server.address();
    this.port = typeof addr === "object" && addr ? addr.port : this.port;
    return `http://${this.host}:${this.port}`;
  }

  async stop() {
    if (!this.server) return;
    await new Promise((resolve) => this.server.close(resolve));
    this.server = null;
  }

  route(req, res) {
    const url = new URL(req.url, "http://localhost");
    const sendJson = (code, body, headers) => {
      res.writeHead(code, { "content-type": "application/json; charset=utf-8", ...headers });
      res.end(JSON.stringify(body));
    };

    // 公開サーバー用の鍵: VISIONONE_BASIC_USER/PASSWORD を設定すると
    // ブラウザの標準的なログイン画面で保護される(未設定なら認証なし)
    // 例外: /api/health はBaseの死活監視(Render等)が叩くため認証を通す
    if (url.pathname !== "/api/health" && !this.checkBasicAuth(req)) {
      res.writeHead(401, { "www-authenticate": 'Basic realm="VisionOne"' });
      res.end("Authentication required");
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readFileSync(join(WEB_DIR, "index.html")));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(200, { ok: true, service: "VisionOne", threads: this.store.threads.size });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      sendJson(200, this.state());
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/messages") {
      readBody(req)
        .then((body) => this.postMessages(body))
        .then(() => sendJson(200, { ok: true }))
        .catch((err) => sendJson(400, { ok: false, error: err.message }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/react") {
      readBody(req)
        .then((body) => {
          if (!body.threadId || !body.messageId || !body.emoji) {
            throw new Error("threadId, messageId, emoji required");
          }
          this.store.addReaction(body.threadId, body.messageId, body.emoji, body.by ?? "you");
          return { ok: true };
        })
        .then((r) => sendJson(200, r))
        .catch((err) => sendJson(400, { ok: false, error: err.message }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/cookies") {
      readBody(req)
        .then((body) => {
          if (!body.host || !body.cookies) throw new Error("host and cookies required");
          return this.team.registerCookies(body.host, body.cookies);
        })
        .then((r) => sendJson(200, { ok: r.ok, ...r }))
        .catch((err) => sendJson(400, { ok: false, error: err.message }));
      return;
    }
    sendJson(404, { error: "not found" });
  }

  state() {
    return {
      team: {
        leader: this.team.leader,
        workers: [...this.team.workers.values()],
      },
      threads: [...this.store.threads.values()],
    };
  }

  async postMessages(body) {
    if (!body.text) return { ok: false };
    const threadId = body.threadId || `webchat:direct-${Date.now().toString(36)}`;
    const envelope = makeEnvelope({
      channel: "webchat",
      chatId: threadId,
      threadId,
      sender: body.sender ?? "you",
      name: body.name ?? "あなた",
      text: String(body.text),
    });
    await this.team.handle(envelope);
  }

  checkBasicAuth(req) {
    if (!this.basicUser || !this.basicPassword) return true;
    const header = req.headers.authorization ?? "";
    const m = /^Basic (.+)$/i.exec(header);
    if (!m) return false;
    const expected = Buffer.from(`${this.basicUser}:${this.basicPassword}`).toString("base64");
    const got = m[1];
    if (got.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(got), Buffer.from(expected));
  }
}

function timingSafeEqual(a, b) {
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) reject(new Error("payload too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });
}
