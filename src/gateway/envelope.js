// チャネル横断で共通のメッセージ形式。
// Instinct の「絵文字リアクション」「スレッド」を第一級の概念として含める。

export function makeEnvelope({
  channel,
  chatId,
  threadId = null,
  sender,
  name = sender,
  text,
  replyTo = null,
  type = "text",
  ts = Date.now(),
}) {
  if (!channel) throw new Error("envelope requires channel");
  if (!chatId) throw new Error("envelope requires chatId");
  if (!sender) throw new Error("envelope requires sender");
  if (typeof text !== "string") throw new Error("envelope requires text");
  return {
    id: `env_${ts.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    channel,
    chatId,
    threadId,
    sender,
    name,
    text,
    replyTo,
    type,
    ts,
  };
}

// Telegram Bot API の update を正規化
export function normalizeTelegram(update) {
  const msg = update?.message ?? update?.channel_post;
  if (!msg || typeof msg.text !== "string") return null;
  return makeEnvelope({
    channel: "telegram",
    chatId: String(msg.chat?.id ?? "unknown"),
    threadId: msg.message_thread_id != null ? String(msg.message_thread_id) : null,
    sender: String(msg.from?.id ?? msg.chat?.id ?? "unknown"),
    name: msg.from?.username ?? msg.from?.first_name ?? "unknown",
    text: msg.text,
    replyTo: msg.reply_to_message?.message_id != null ? String(msg.reply_to_message.message_id) : null,
    ts: (msg.date ?? Math.floor(Date.now() / 1000)) * 1000,
  });
}

// BlueBubbles (iMessage bridge) の webhook payload を正規化
export function normalizeBlueBubbles(body) {
  const text = body?.text ?? body?.payload?.text;
  if (typeof text !== "string") return null;
  return makeEnvelope({
    channel: "imessage",
    chatId: String(body?.chatGuid ?? body?.payload?.chatGuid ?? "unknown"),
    sender: String(body?.from ?? "unknown"),
    name: body?.fromName ?? body?.from ?? "unknown",
    text,
    ts: body?.date ?? Date.now(),
  });
}

export function extractMention(text) {
  const m = /^@([A-Za-z0-9_-]+)/.exec(text.trim());
  return m ? m[1] : null;
}
