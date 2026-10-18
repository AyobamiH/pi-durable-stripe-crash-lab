import { test } from "node:test";
import assert from "node:assert/strict";
import { environmentForChild } from "./process-env.mjs";

test("isolates test Stripe credentials to the external gateway", () => {
  const base = {
    STRIPE_TEST_SECRET_KEY: "sk_test_dummy_never_real",
    HOME: "/tmp/example",
    NODE_ENV: "test"
  };
  assert.equal(environmentForChild(base, {}, "gateway").STRIPE_TEST_SECRET_KEY, base.STRIPE_TEST_SECRET_KEY);
  assert.equal(environmentForChild(base, {}, "wrangler").STRIPE_TEST_SECRET_KEY, undefined);
  assert.equal(environmentForChild(base, {}, "worker").STRIPE_TEST_SECRET_KEY, undefined);
  assert.equal(environmentForChild(base, {}, "wrangler").HOME, base.HOME);
  assert.equal(base.STRIPE_TEST_SECRET_KEY, "sk_test_dummy_never_real");
});
