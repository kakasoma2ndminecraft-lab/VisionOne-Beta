import { parseCookieInput } from "./vault.js";

// PC-Use スキルへの「クッキーを渡すだけでログイン」をDemonstrateする。
// 実運用ではここで Playwright の context.addCookies() 等に接続する。

export class CookieLoginSkill {
  constructor(vault) {
    this.vault = vault;
  }

  register(identity, cookieText) {
    let parsed;
    try {
      parsed = parseCookieInput(cookieText);
    } catch (err) {
      return { ok: false, error: `cookie parse failed: ${err.message}` };
    }
    if (parsed.length === 0) {
      return { ok: false, error: "no cookies found in input" };
    }
    const { imported } = this.vault.importCookies(identity, cookieText);
    return { ok: true, identity, imported };
  }

  status(identity) {
    return { identity, loggedIn: this.vault.hasSession(identity) };
  }

  // Bot がサイトにアクセスするときのログイン状態を返す(案内は不要)
  loginStateFor(identity) {
    return this.vault.hasSession(identity)
      ? "logged-in (cookies restored, no user guidance needed)"
      : "guest (no cookies on file)";
  }
}
