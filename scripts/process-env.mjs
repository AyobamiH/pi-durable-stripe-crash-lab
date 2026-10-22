/** Keep the Stripe test credential exclusively in the external gateway. */
export function environmentForChild(parentEnv, extraEnv, role) {
  const result = { ...parentEnv, ...extraEnv };
  if (role !== "gateway") {
    delete result.STRIPE_TEST_SECRET_KEY;
    delete result.STRIPE_TEST_KEY_FILE;
  }
  return result;
}
