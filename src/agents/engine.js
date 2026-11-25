import { extractMention } from "../gateway/envelope.js";
import { stableReaction } from "../store/session-store.js";

// 応答エンジン。APIキーがなくても動く Echo エンジンと、
// OpenAI互換エンドポイントに投げる Http エンジン(環境変数で有効化)を用意。

const DELEGATION_KEYWORDS = [
  { match: /(調査|リサーチ|探し|さがし|research|調べて)/, worker: "Sora" },
  { match: /(予約|手配|購入|注文|booking|organize|取って)/, worker: "Ren" },
];

export class EchoEngine {
  delegateTarget(text) {
    const hit = DELEGATION_KEYWORDS.find((k) => k.match.test(text));
    return hit ? hit.worker : null;
  }

  reply(persona, _history, message) {
    const mention = extractMention(message.text);
    const addr = mention ? `@${mention} ` : "";
    const flavor = `${persona.emoji} ${persona.role}として対応しました`;
    return `${addr}了解、${flavor}。「${truncate(message.text, 60)}」を進めておきます。`;
  }

  leaderDelegationMessage(leader, worker, taskText) {
    return `@${worker.name} ${worker.emoji} これお願い → 「${truncate(taskText, 80)}」`;
  }

  workerAck(worker) {
    return `${worker.emoji} 承りました。PCで処理します。`;
  }
}

function truncate(text, n = 60) {
  return text.length > n ? `${text.slice(0, n)}…` : text;
}

// OpenAI 互換 API への接続例(オプション):
//   VISIONONE_LLM_URL=https://api.example.com/v1/chat/completions
//   VISIONONE_LLM_API_KEY=... / VISIONONE_LLM_MODEL=...
export class HttpEngine extends EchoEngine {
  constructor(opts = {}) {
    super();
    this.url = opts.url ?? process.env.VISIONONE_LLM_URL ?? null;
    this.apiKey = opts.apiKey ?? process.env.VISIONONE_LLM_API_KEY ?? null;
    this.model = opts.model ?? process.env.VISIONONE_LLM_MODEL ?? "gpt-4o-mini";
  }

  get available() {
    return Boolean(this.url);
  }

  async reply(persona, history, message) {
    if (!this.available) return super.reply(persona, history, message);
    const messages = [
      {
        role: "system",
        content: `あなたは${persona.name} (${persona.role}) です。${persona.emoji} を挨拶に使います。簡潔に日本語で返答してください。`,
      },
      ...history.map((h) => ({
        role: h.role === "bot" ? "assistant" : "user",
        content: `${h.from}: ${h.text}`,
      })),
      { role: "user", content: message.text },
    ];
    const res = await fetch(this.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify({ model: this.model, messages }),
    });
    if (!res.ok) {
      throw new Error(`LLM request failed: ${res.status}`);
    }
    const data = await res.json();
    return data?.choices?.[0]?.message?.content ?? super.reply(persona, history, message);
  }
}

export function pickReaction(seed) {
  return stableReaction(seed);
}
