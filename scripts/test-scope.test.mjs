import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadPrivateTestKey, verifyTestAccount, assertOperationScope, EXPECTED_ACCOUNT } from "./test-scope.mjs";
import { environmentForChild } from "./process-env.mjs";

const key = "sk_test_" + "x".repeat(24);
test("private loader rejects unsafe modes, symlinks, live keys and executable content", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-private-test-"));
  const file = path.join(dir, "key.env");
  try {
    fs.writeFileSync(file, "STRIPE_TEST_SECRET_KEY=" + key + "\n", { mode: 0o600 });
    assert.equal(loadPrivateTestKey(file), key);
    fs.chmodSync(file, 0o644);
    assert.throws(() => loadPrivateTestKey(file), /0600/);
    fs.chmodSync(file, 0o600);
    fs.symlinkSync(file, path.join(dir, "link"));
    assert.throws(() => loadPrivateTestKey(path.join(dir, "link")));
    for (const input of ["STRIPE_TEST_SECRET_KEY=sk_live_bad", "STRIPE_TEST_SECRET_KEY=" + key + "\necho run"]) {
      fs.writeFileSync(file, input);
      assert.throws(() => loadPrivateTestKey(file), /exactly one test-only/);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("authentication proves exact account and test mode using GET only", async () => {
  const requests = [];
  const fetcher = async (url, options) => {
    requests.push([url, options]);
    return { ok: true, json: async () => url.endsWith("/account") ? { id: EXPECTED_ACCOUNT } : { livemode: false } };
  };
  assert.deepEqual(await verifyTestAccount(key, fetcher), { accountId: EXPECTED_ACCOUNT, livemode: false });
  assert.equal(requests.length, 2);
  assert.ok(requests.every(([, o]) => !o.method && o.redirect === "error"));
});
test("wrong account, live mode, failed auth and live key fail closed", async () => {
  await assert.rejects(verifyTestAccount("sk_live_" + "x".repeat(24)), /Test-only/);
  await assert.rejects(verifyTestAccount(key, async () => ({ok:true,json:async()=>({id:"acct_wrong"})})), /account mismatch/);
  await assert.rejects(verifyTestAccount(key, async url => ({ok:true,json:async()=>url.endsWith("/account")?{id:EXPECTED_ACCOUNT}:{livemode:true}})), /test mode/);
  await assert.rejects(verifyTestAccount(key, async () => ({ok:false,json:async()=>({})})), /authentication/);
});
test("single operation scope blocks other IDs and missing scope", () => {
  assertOperationScope("lab-one", "lab-one");
  assert.throws(() => assertOperationScope("lab-two", "lab-one"), /scope/);
  assert.throws(() => assertOperationScope("lab-one", undefined), /scope/);
});
test("credential source path never reaches the Pi or Wrangler environment", () => {
  const env = { STRIPE_TEST_KEY_FILE: "/private/key.env", STRIPE_TEST_SECRET_KEY: key };
  assert.deepEqual(environmentForChild(env, {}, "wrangler"), {});
  assert.equal(environmentForChild(env, {}, "gateway").STRIPE_TEST_KEY_FILE, env.STRIPE_TEST_KEY_FILE);
});
