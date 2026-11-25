import { createInterface } from "node:readline";
import { makeEnvelope } from "./envelope.js";

// ターミナル REPL チャネル。OTOMO_CONSOLE=1 で有効化。

export class ConsoleChannel {
  constructor({ team, store, input = process.stdin, output = process.stdout } = {}) {
    this.team = team;
    this.store = store;
    this.input = input;
    this.output = output;
    this.threadId = "console:main";
    this.rl = null;
  }

  get name() {
    return "console";
  }

  async start() {
    this.output.write("otomo console (exit: /quit)\n> ");
    this.rl = createInterface({ input: this.input, terminal: false });
    this.rl.on("line", (line) => this.onLine(line.trim()));
    return "console ready";
  }

  async stop() {
    this.rl?.close();
    this.rl = null;
  }

  async onLine(text) {
    if (!text || text === "/quit") {
      this.stop();
      return;
    }
    const envelope = makeEnvelope({
      channel: "console",
      chatId: "main",
      threadId: this.threadId,
      sender: "you",
      name: "あなた",
      text,
    });
    await this.team.handle(envelope);
    const thread = this.store.getThread(this.threadId);
    const last = thread.messages.at(-1);
    if (last) this.output.write(`${last.name}: ${last.text}\n> `);
  }
}
