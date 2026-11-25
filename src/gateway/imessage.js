import { normalizeBlueBubbles } from "./envelope.js";

// iMessage チャネル (BlueBubbles REST ブリッジ経由)。
// macOS + BlueBubbles サーバが必要。OTOMO_BLUEBUBBLES_URL / OTOMO_BLUEBUBBLES_PASSWORD。
// 受信は webhook (POST /api/hooks/bluebubbles) で受ける。

export class IMessageChannel {
  constructor({ team, url, password, onEnvelope } = {}) {
    this.team = team;
    this.url = url ?? process.env.OTOMO_BLUEBUBBLES_URL ?? null;
    this.password = password ?? process.env.OTOMO_BLUEBUBBLES_PASSWORD ?? null;
    this.onEnvelope = onEnvelope;
  }

  get name() {
    return "imessage";
  }

  get available() {
    return Boolean(this.url && this.password);
  }

  async start() {
    if (!this.available) return "imessage disabled (no OTOMO_BLUEBUBBLES_URL/PASSWORD)";
    return "imessage bridge ready (webhook: POST /api/hooks/bluebubbles)";
  }

  async stop() {}

  webhookHandler() {
    return async (body) => {
      const envelope = normalizeBlueBubbles(body);
      if (envelope && this.onEnvelope) await this.onEnvelope(envelope);
    };
  }

  async send(outbound) {
    if (!this.available || outbound.type !== "message") return;
    const thread = this.team?.store?.getThread?.(outbound.threadId);
    if (!thread) return;
    const chatGuid = thread.id.replace(/^imessage:/, "");
    try {
      const res = await fetch(
        `${this.url}/api/v1/message/text?password=${encodeURIComponent(this.password)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ chatGuid, message: outbound.message.text, method: "private-api" }),
        },
      );
      if (!res.ok) throw new Error(`send -> ${res.status}`);
    } catch (err) {
      console.error("[imessage] send error:", err.message);
    }
  }
}
