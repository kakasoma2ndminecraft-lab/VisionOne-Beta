import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../src/store/session-store.js";
import { EchoEngine } from "../src/agents/engine.js";
import { Team } from "../src/agents/team.js";
import { WebChatChannel } from "../src/gateway/webchat.js";

const PERSONAS = {
  leader: { name: "Aki", role: "リーダー", emoji: "🧠" },
  workers: [{ name: "Sora", role: "リサーチ係", emoji: "🔍" }],
};

async function boot({ basicUser = null, basicPassword = null } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "visionone-webchat-"));
  const store = new SessionStore(join(dir, "data"));
  const team = await Team.create({ store, engine: new EchoEngine(), dataDir: join(dir, "data"), personas: PERSONAS });
  const channel = new WebChatChannel({ team, store, port: 0, host: "127.0.0.1", basicUser, basicPassword });
  const url = await channel.start();
  return { dir, channel, url };
}

test("認証情報未設定なら従来どおり認証なしで使える", async () => {
  const { dir, channel, url } = await boot();
  try {
    const state = await (await fetch(`${url}/api/state`)).json();
    assert.equal(state.team.leader.name, "Aki");
    const health = await (await fetch(`${url}/api/health`)).json();
    assert.equal(health.ok, true);
  } finally {
    await channel.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Basic認証設定時: 認証なしは401、正しい認証情報なら通る", async () => {
  const { dir, channel, url } = await boot({ basicUser: "me", basicPassword: "secret" });
  try {
    const health = await fetch(`${url}/api/health`);
    assert.equal(health.status, 200); // 死活監視(Render等)のため認証を通す

    const noAuth = await fetch(`${url}/api/state`);
    assert.equal(noAuth.status, 401);
    assert.match(noAuth.headers.get("www-authenticate"), /Basic/);

    const good = "Basic " + Buffer.from("me:secret").toString("base64");
    const ok = await fetch(`${url}/api/health`, { headers: { authorization: good } });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).service, "VisionOne");

    const bad = "Basic " + Buffer.from("me:wrong").toString("base64");
    const ng = await fetch(`${url}/api/state`, { headers: { authorization: bad } });
    assert.equal(ng.status, 401);
  } finally {
    await channel.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
