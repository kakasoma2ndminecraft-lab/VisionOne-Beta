import { extractMention } from "../gateway/envelope.js";
import { CookieLoginSkill } from "../skills/cookie-login.js";
import { ComputerUse } from "../skills/computer-use.js";
import { pickReaction } from "./engine.js";

// チーム本体。リーダーBot + 専門Botたち。
// - @name で指名すればそのBot、なければリーダーが受ける
// - リーダーは内容を見てワーカーへ委任(GrokBot のチーム方式)
// - ワーカーはPC-Useで実行し、クッキーがあればログイン誘導なしで処理
// - 受け答えの最初に絵文字リアクションを付ける(Instinct の「人間味」)

export class Team {
  constructor({ store, engine, personas }) {
    if (!store) throw new Error("Team requires store");
    if (!engine) throw new Error("Team requires engine");
    if (!personas?.leader || !Array.isArray(personas.workers)) {
      throw new Error("Team requires personas.leader and personas.workers");
    }
    this.store = store;
    this.engine = engine;
    this.leader = personas.leader;
    this.workers = new Map(personas.workers.map((w) => [w.name, w]));
    this.computerUse = new ComputerUse();
    this.outbound = []; // チャネルへの送出ログ(デバッグ/テスト用)
    this.onOutbound = null;
    this.vault = null;
    this.cookieLogin = null;
  }

  static async create({ store, engine, personas, dataDir }) {
    const { SessionVault } = await import("../skills/vault.js");
    const team = new Team({ store, engine, personas });
    team.vault = new SessionVault(dataDir);
    team.cookieLogin = new CookieLoginSkill(team.vault);
    return team;
  }

  emit(envelope) {
    this.outbound.push(envelope);
    if (this.onOutbound) this.onOutbound(envelope);
  }

  memberByName(name) {
    if (name === this.leader.name) return this.leader;
    return this.workers.get(name) ?? null;
  }

  async handle(envelope) {
    const thread = this.store.ensureThread(envelope.threadId ?? envelope.chatId, {
      title: deriveTitle(envelope),
      channel: envelope.channel,
    });
    const userMsg = this.store.appendMessage(thread.id, {
      from: envelope.sender,
      name: envelope.name,
      text: envelope.text,
      role: "user",
      replyTo: envelope.replyTo,
    });

    const target = this.resolveTarget(envelope);
    await this.replyAs(target, thread.id, userMsg, envelope);
    return thread;
  }

  resolveTarget(envelope) {
    const mention = extractMention(envelope.text);
    if (mention) {
      const member = this.memberByName(mention);
      if (member) return member;
    }
    return this.leader;
  }

  async react(threadId, messageId, bot, emoji) {
    const chosen = emoji ?? pickReaction(messageId + bot.name);
    const msg = this.store.addReaction(threadId, messageId, chosen, bot.name);
    if (msg) {
      this.emit({
        id: `rxn_${Date.now().toString(36)}`,
        type: "reaction",
        threadId,
        from: bot.name,
        emoji: chosen,
        target: messageId,
      });
    }
    return msg;
  }

  async replyAs(bot, threadId, userMsg, envelope) {
    const isLeader = bot.name === this.leader.name;
    const delegateTo = isLeader ? this.engine.delegateTarget(envelope.text) : null;

    await this.react(threadId, userMsg.id, bot);

    if (delegateTo && this.workers.has(delegateTo)) {
      const worker = this.workers.get(delegateTo);
      const delegation = this.store.appendMessage(threadId, {
        from: bot.name,
        name: bot.name,
        text: this.engine.leaderDelegationMessage(this.leader, worker, envelope.text),
        role: "bot",
        meta: { kind: "delegation", to: worker.name },
      });
      this.emit({ type: "message", threadId, message: delegation });
      await this.react(threadId, delegation.id, worker);
      await this.runComputerTask(threadId, worker, envelope.text);
      return;
    }

    const history = this.store.summarizeForPrompt(threadId);
    const text = await this.engine.reply(bot, history, envelope);
    const reply = this.store.appendMessage(threadId, {
      from: bot.name,
      name: bot.name,
      text,
      role: "bot",
      meta: { kind: isLeader ? "reply" : "worker-reply" },
    });
    this.emit({ type: "message", threadId, message: reply });
  }

  async runComputerTask(threadId, worker, taskText) {
    const urlHost = hostOf(taskText);
    const loginState =
      urlHost && this.vault?.hasSession(`host:${urlHost}`)
        ? "logged-in (cookies restored, no user guidance needed)"
        : "guest";
    const ack = this.store.appendMessage(threadId, {
      from: worker.name,
      name: worker.name,
      text: this.engine.workerAck(worker),
      role: "bot",
      meta: { kind: "pc-ack" },
    });
    this.emit({ type: "message", threadId, message: ack });

    const run = await this.computerUse.run(taskText, { loginState });
    const detail =
      run.engine === "stub" && run.steps ? run.steps.map((s) => `· ${s}`).join("\n") : String(run.result ?? "");
    const resultMsg = this.store.appendMessage(threadId, {
      from: worker.name,
      name: worker.name,
      text: `${run.result}\n${detail}`,
      role: "bot",
      meta: { kind: "pc-result", engine: run.engine, loginState: run.loginState },
    });
    this.emit({ type: "message", threadId, message: resultMsg });
    return run;
  }

  registerCookies(host, cookieText) {
    if (!this.cookieLogin) throw new Error("cookieLogin not initialized (use Team.create)");
    return this.cookieLogin.register(`host:${host}`, cookieText);
  }

  loginState(host) {
    if (!this.cookieLogin) throw new Error("cookieLogin not initialized (use Team.create)");
    return this.cookieLogin.loginStateFor(`host:${host}`);
  }
}

function deriveTitle(envelope) {
  if (envelope.threadId) return envelope.threadId;
  const first = envelope.text.split("\n")[0].slice(0, 40);
  return first || `${envelope.channel} chat`;
}

function hostOf(text) {
  const m = /https?:\/\/([^/\s)]+)/.exec(text ?? "");
  return m ? m[1] : null;
}
