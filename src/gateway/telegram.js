import { normalizeTelegram } from "./envelope.js";

// Telegram チャネル(ロングポーリング)。VISIONONE_TELEGRAM_TOKEN で有効化。
// 将来の本格チャネル(絵文字リアクション付き)のリファレンス実装。

const API = "https://api.telegram.org";

export class TelegramChannel {
  constructor({ team, token, onEnvelope, pollMs = 1500 } = {}) {
    this.team = team;
    this.token = token ?? process.env.VISIONONE_TELEGRAM_TOKEN ?? null;
    this.onEnvelope = onEnvelope;
    this.pollMs = pollMs;
    this.offset = 0;
    this.running = false;
  }

  get name() {
    return "telegram";
  }

  get available() {
    return Boolean(this.token);
  }

  async start() {
    if (!this.available) return "telegram disabled (no VISIONONE_TELEGRAM_TOKEN)";
    this.running = true;
    this.loop().catch((err) => console.error("[telegram] poll error:", err.message));
    return "telegram polling started";
  }

  async stop() {
    this.running = false;
  }

  async loop() {
    while (this.running) {
      try {
        const updates = await this.call("getUpdates", { offset: this.offset, timeout: 0 });
        for (const update of updates) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          const envelope = normalizeTelegram(update);
          if (envelope && this.onEnvelope) await this.onEnvelope(envelope);
        }
      } catch (err) {
        console.error("[telegram] error:", err.message);
      }
      await sleep(this.pollMs);
    }
  }

  async send(outbound) {
    if (!this.available || outbound.type !== "message") return;
    const thread = this.team?.store?.getThread?.(outbound.threadId);
    const chatId = thread?.channel === "telegram" ? thread.id.split(":")[1] : null;
    if (!chatId) return;
    try {
      await this.call("sendMessage", { chat_id: chatId, text: outbound.message.text });
    } catch (err) {
      console.error("[telegram] send error:", err.message);
    }
  }

  async call(method, params) {
    const res = await fetch(`${API}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`${method} -> ${res.status}`);
    const data = await res.json();
    return data.result ?? [];
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
