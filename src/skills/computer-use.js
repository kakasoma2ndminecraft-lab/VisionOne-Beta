import { spawn } from "node:child_process";

// Computer Use 実行エンジン。
// Instinct の PC-Use 弱点への回答: 自前実装ではなく、既存で最強の
// Claude Code / OpenCode の PC-Use Skill を後段エンジンとしてそのまま使う。
//
// - VISIONONE_PCUSE_CMD が設定されていれば、コマンドの stdin にタスクJSONを渡し、
//   stdout を実行結果として扱う(OpenCode / Claude PC-Use Skill へのアダプタ点)
// - 未設定なら scripted ドライバでデモ動作する

export class ComputerUse {
  constructor() {
    this.cmd = process.env.VISIONONE_PCUSE_CMD ?? null;
  }

  get engineName() {
    return this.cmd ? "custom (VISIONONE_PCUSE_CMD)" : "stub";
  }

  async run(task, { loginState = "guest" } = {}) {
    if (this.cmd) {
      return this.runCustom(task, { loginState });
    }
    return this.runStub(task, { loginState });
  }

  runCustom(task, { loginState }) {
    return new Promise((resolve, reject) => {
      const child = spawn(this.cmd, { shell: true, stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (err += d));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code !== 0) {
          reject(new Error(`PC-Use engine exited ${code}: ${err.slice(-400)}`));
          return;
        }
        resolve({ ok: true, engine: this.engineName, loginState, result: out.trim() });
      });
      child.stdin.end(JSON.stringify({ task, loginState }));
    });
  }

  async runStub(task, { loginState }) {
    const url = extractUrl(task);
    const steps = [];
    if (url) {
      steps.push(`browser.open(${url})`);
      if (loginState.startsWith("logged-in")) {
        steps.push("session.restore(vault cookies) -> ログイン誘導をスキップ");
      } else {
        steps.push("session.guest() -> ログイン手順が必要な状態");
      }
    }
    steps.push("desktop.locate(task target)");
    steps.push("act: click/type/scroll (scripted demo)");
    await sleep(150);
    return {
      ok: true,
      engine: this.engineName,
      loginState,
      steps,
      result: `「${truncate(task, 80)}」をPC上で処理しました (${loginState})`,
    };
  }
}

export function extractUrl(text) {
  const m = /https?:\/\/[^\s)]+/.exec(text ?? "");
  return m ? m[0] : null;
}

function truncate(text, n) {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
