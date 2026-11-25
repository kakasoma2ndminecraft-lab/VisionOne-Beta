import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeEnvelope, normalizeTelegram, extractMention } from "../src/gateway/envelope.js";
import { SessionStore, stableReaction } from "../src/store/session-store.js";
import { EchoEngine } from "../src/agents/engine.js";
import { Team } from "../src/agents/team.js";

function makeDataDir() {
  return mkdtempSync(join(tmpdir(), "visionone-team-"));
}

function personas(extraWorker) {
  const workers = [{ name: "Sora", role: "リサーチ係", emoji: "🔍" }];
  if (extraWorker) workers.push(extraWorker);
  return { leader: { name: "Aki", role: "リーダー", emoji: "🧠" }, workers };
}

test("envelope/正規化: Telegram update が共通形式になる", () => {
  const envelope = normalizeTelegram({
    message: {
      chat: { id: 42 },
      from: { id: 100, username: "taro" },
      text: "こんにちは",
      date: 1700000000,
      reply_to_message: { message_id: 7 },
    },
  });
  assert.equal(envelope.channel, "telegram");
  assert.equal(envelope.chatId, "42");
  assert.equal(envelope.sender, "100");
  assert.equal(envelope.replyTo, "7");
  assert.equal(extractMention("@Sora これ調べて"), "Sora");
});

test("チーム: 指名なしはリーダーが応答し、リアクションが付く", async () => {
  const dir = makeDataDir();
  try {
    const store = new SessionStore(dir);
    const team = await Team.create({ store, engine: new EchoEngine(), dataDir: dir, personas: personas() });
    const envelope = makeEnvelope({ channel: "webchat", chatId: "t1", sender: "you", text: "こんにちは" });
    await team.handle(envelope);
    const thread = store.getThread("t1");
    assert.equal(thread.messages.length, 2);
    assert.equal(thread.messages[0].role, "user");
    assert.equal(thread.messages[1].from, "Aki");
    assert.ok(thread.messages[0].reactions.length >= 1);
    assert.ok(team.outbound.some((o) => o.type === "reaction"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("チーム: 「調査」キーワードでリーダーがSoraに委任しPC-Useが走る", async () => {
  const dir = makeDataDir();
  try {
    const store = new SessionStore(dir);
    const team = await Team.create({ store, engine: new EchoEngine(), dataDir: dir, personas: personas() });
    const envelope = makeEnvelope({ channel: "webchat", chatId: "t2", sender: "you", text: "この課題を調査して" });
    await team.handle(envelope);
    const thread = store.getThread("t2");
    const texts = thread.messages.map((m) => m.text).join("\n");
    assert.match(texts, /@Sora/); // 委任メッセージ
    assert.match(texts, /PC上で処理しました/); // PC-Use 実行結果
    const kinds = thread.messages.map((m) => m.meta?.kind);
    assert.ok(kinds.includes("pc-ack"));
    assert.ok(kinds.includes("pc-result"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("チーム: @Sora 指名はSoraが直接応答する", async () => {
  const dir = makeDataDir();
  try {
    const store = new SessionStore(dir);
    const team = await Team.create({ store, engine: new EchoEngine(), dataDir: dir, personas: personas() });
    const envelope = makeEnvelope({ channel: "webchat", chatId: "t3", sender: "you", text: "@Sora 進捗は？" });
    await team.handle(envelope);
    const last = store.getThread("t3").messages.at(-1);
    assert.equal(last.from, "Sora");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("チーム: クッキー登録済みホストのタスクはログイン済みで処理される", async () => {
  const dir = makeDataDir();
  try {
    const store = new SessionStore(dir);
    const team = await Team.create({
      store,
      engine: new EchoEngine(),
      dataDir: dir,
      personas: personas({ name: "Ren", role: "手配係", emoji: "📅" }),
    });
    assert.equal(team.loginState("example.com"), "guest (no cookies on file)");
    team.registerCookies("example.com", "sid=xyz");
    assert.equal(team.loginState("example.com"), "logged-in (cookies restored, no user guidance needed)");

    const envelope = makeEnvelope({
      channel: "webchat",
      chatId: "t4",
      sender: "you",
      text: "https://example.com/orders の予約を手配して",
    });
    await team.handle(envelope);
    const result = store.getThread("t4").messages.find((m) => m.meta?.kind === "pc-result");
    assert.equal(result.meta.loginState, "logged-in (cookies restored, no user guidance needed)");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SessionStore: スレッドごとにセッションが分かれ、永続化される", async () => {
  const dir = makeDataDir();
  try {
    const store = new SessionStore(dir);
    store.ensureThread("a", { title: "A", channel: "webchat" });
    store.ensureThread("b", { title: "B", channel: "telegram" });
    store.appendMessage("a", { from: "you", text: "hello" });
    const reloaded = new SessionStore(dir);
    assert.equal(reloaded.threads.size, 2);
    assert.equal(reloaded.getThread("a").messages[0].text, "hello");
    assert.equal(reloaded.getThread("b").channel, "telegram");
    assert.equal(stableReaction("x"), stableReaction("x"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
