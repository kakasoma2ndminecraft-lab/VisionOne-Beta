import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// GrokBot 方式の「共有クラウドPC」を模したクッキー保管庫。
// ユーザーはログイン案内をせず、クッキーを貼るだけで Bot がログイン済み状態を作れる。
// 注意: 実運用では 0600 のローカルファイル以上の保護(KMS 等)が必要。

const DEFAULT_DATA_DIR = ".otomo-data";

export function parseCookieInput(raw) {
  const text = (raw ?? "").trim();
  if (!text) return [];
  if (text.startsWith("{") || text.startsWith("[")) {
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed)
      ? parsed
      : Object.entries(parsed).map(([name, value]) => ({ name, value }));
    return arr
      .map((c) => ({
        name: String(c.name ?? ""),
        value: String(c.value ?? ""),
        domain: c.domain ?? null,
      }))
      .filter((c) => c.name);
  }
  if (text.startsWith("#") || text.includes("\t")) {
    // Netscape cookies.txt 形式
    return text
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.split("\t"))
      .filter((cols) => cols.length >= 7)
      .map((cols) => ({ domain: cols[0], name: cols[5], value: cols[6] }))
      .filter((c) => c.name);
  }
  // "k=v; k2=v2" (document.cookie / Set-Cookie 形式)
  return text
    .split(";")
    .map((pair) => pair.trim())
    .filter(Boolean)
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq <= 0) return null;
      return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim(), domain: null };
    })
    .filter(Boolean);
}

export class SessionVault {
  constructor(dataDir = process.env.OTOMO_DATA_DIR ?? DEFAULT_DATA_DIR) {
    this.path = join(dataDir, "vault.json");
    this.sessions = new Map();
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      for (const [key, value] of Object.entries(parsed.sessions ?? {})) {
        this.sessions.set(key, value);
      }
    } catch {
      // 初回は空
    }
  }

  persist() {
    mkdirSync(dirname(this.path), { recursive: true });
    const payload = { savedAt: Date.now(), sessions: Object.fromEntries(this.sessions) };
    writeFileSync(this.path, JSON.stringify(payload, null, 2), { mode: 0o600 });
  }

  importCookies(identity, raw) {
    const cookies = parseCookieInput(raw);
    if (cookies.length === 0) return { imported: 0 };
    this.sessions.set(identity, { cookies, importedAt: Date.now(), loggedIn: true });
    this.persist();
    return { imported: cookies.length };
  }

  hasSession(identity) {
    const s = this.sessions.get(identity);
    return Boolean(s?.loggedIn && s.cookies?.length);
  }

  erase(identity) {
    const existed = this.sessions.delete(identity);
    if (existed) this.persist();
    return existed;
  }
}
