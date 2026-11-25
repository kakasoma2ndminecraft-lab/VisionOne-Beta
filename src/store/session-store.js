import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// スレッド(会話の文脈)単位でセッションを分離する。
// Instinct の「1つのチャット内でしか会話できない」問題への回答:
// チャネル上のスレッド / グループ / プロジェクトごとに独立したセッションを持つ。

const DEFAULT_DATA_DIR = ".visionone-data";

export class SessionStore {
  constructor(dataDir = process.env.VISIONONE_DATA_DIR ?? DEFAULT_DATA_DIR) {
    this.dataDir = dataDir;
    this.path = join(this.dataDir, "sessions.json");
    this.threads = new Map();
    this.load();
  }

  load() {
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw);
      for (const t of parsed.threads ?? []) {
        this.threads.set(t.id, { ...t });
      }
    } catch {
      // 初回起動時はファイルがない
    }
  }

  persist() {
    mkdirSync(this.dataDir, { recursive: true });
    const payload = { savedAt: Date.now(), threads: [...this.threads.values()] };
    writeFileSync(this.path, JSON.stringify(payload, null, 2), { mode: 0o600 });
  }

  getThread(threadId) {
    return this.threads.get(threadId) ?? null;
  }

  ensureThread(threadId, { title, channel } = {}) {
    if (!threadId) throw new Error("threadId is required");
    if (!this.threads.has(threadId)) {
      this.threads.set(threadId, {
        id: threadId,
        title: title ?? `Thread ${this.threads.size + 1}`,
        channel: channel ?? "webchat",
        createdAt: Date.now(),
        messages: [],
      });
      this.persist();
    }
    return this.threads.get(threadId);
  }

  appendMessage(threadId, msg) {
    const thread = this.ensureThread(threadId);
    const entry = {
      id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      from: msg.from,
      name: msg.name ?? msg.from,
      text: msg.text,
      role: msg.role ?? "user",
      meta: msg.meta ?? null,
      replyTo: msg.replyTo ?? null,
      reactions: [],
      ts: msg.ts ?? Date.now(),
    };
    thread.messages.push(entry);
    this.persist();
    return entry;
  }

  addReaction(threadId, messageId, emoji, by) {
    const thread = this.getThread(threadId);
    if (!thread) return null;
    const msg = thread.messages.find((m) => m.id === messageId);
    if (!msg) return null;
    msg.reactions.push({ emoji, by, ts: Date.now() });
    this.persist();
    return msg;
  }

  summarizeForPrompt(threadId, limit = 20) {
    const thread = this.getThread(threadId);
    if (!thread) return [];
    return thread.messages.slice(-limit).map((m) => ({ from: m.name, role: m.role, text: m.text }));
  }
}

export function stableReaction(seed) {
  const pool = ["\u{1F44D}", "\u{1FAE1}", "\u2705", "\u{1F64C}"];
  const h = createHash("sha256").update(seed).digest()[0];
  return pool[h % pool.length];
}
