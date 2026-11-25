import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCookieInput, SessionVault } from "../src/skills/vault.js";
import { CookieLoginSkill } from "../src/skills/cookie-login.js";

test("parseCookieInput は3形式(header/JSON/Netscape)をパースする", () => {
  const header = parseCookieInput("session_id=abc123; theme=dark");
  assert.equal(header.length, 2);
  assert.deepEqual(header[0], { name: "session_id", value: "abc123", domain: null });

  const json = parseCookieInput('{"sid": "xyz", "lang": "ja"}');
  assert.equal(json.length, 2);
  assert.equal(json[0].name, "sid");

  const netscape = parseCookieInput(
    "# Netscape HTTP Cookie File\n.example.com\tTRUE\t/\tTRUE\t1900000000\tSID\ts%3Aabc\n",
  );
  assert.equal(netscape.length, 1);
  assert.equal(netscape[0].name, "SID");
  assert.equal(netscape[0].domain, ".example.com");
});

test("CookieLoginSkill はクッキー登録だけでログイン済み状態を作る", () => {
  const dir = mkdtempSync(join(tmpdir(), "visionone-vault-"));
  try {
    const vault = new SessionVault(dir);
    const skill = new CookieLoginSkill(vault);
    assert.equal(vault.hasSession("host:example.com"), false);

    const r = skill.register("host:example.com", "session_id=abc123");
    assert.equal(r.ok, true);
    assert.equal(r.imported, 1);
    assert.equal(vault.hasSession("host:example.com"), true);
    assert.match(skill.loginStateFor("host:example.com"), /logged-in/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("SessionVault は永続化され、erase で削除できる", () => {
  const dir = mkdtempSync(join(tmpdir(), "visionone-vault2-"));
  try {
    const vault = new SessionVault(dir);
    vault.importCookies("host:example.com", "a=1");
    const reloaded = new SessionVault(dir);
    assert.equal(reloaded.hasSession("host:example.com"), true);
    assert.equal(reloaded.erase("host:example.com"), true);
    assert.equal(reloaded.hasSession("host:example.com"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
