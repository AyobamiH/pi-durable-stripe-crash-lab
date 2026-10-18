/** Keep the Stripe test credential exclusively in the external gateway. */
export function environmentForChild(parentEnv, extraEnv, role) {
  const result = { ...parentEnv, ...extraEnv };
  if (role !== "gateway") delete result.STRIPE_TEST_SECRET_KEY;
  return result;
}
