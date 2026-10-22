import fs from "node:fs";

export const EXPECTED_ACCOUNT = "acct_1QNKKrGbPfXt7ec5";

export function loadPrivateTestKey(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.uid !== process.getuid() || (st.mode & 0o777) !== 0o600 || st.size > 4096) {
      throw new Error("Credential file must be owner-only, regular, and mode 0600");
    }
    const match = /^STRIPE_TEST_SECRET_KEY=(sk_test_[A-Za-z0-9]{16,})\s*$/.exec(fs.readFileSync(fd, "utf8").trim());
    if (!match) throw new Error("Credential file must contain exactly one test-only key assignment");
    return match[1];
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}

export async function verifyTestAccount(key, fetcher = fetch) {
  if (!/^sk_test_[A-Za-z0-9]{16,}$/.test(key)) throw new Error("Test-only credential required");
  const options = { headers: { authorization: "Bearer " + key }, redirect: "error", signal: AbortSignal.timeout(10000) };
  const accountResponse = await fetcher("https://api.stripe.com/v1/account", options);
  const account = await accountResponse.json();
  if (!accountResponse.ok || account.id !== EXPECTED_ACCOUNT) throw new Error("Stripe account mismatch or authentication failed");
  const balanceResponse = await fetcher("https://api.stripe.com/v1/balance", options);
  const balance = await balanceResponse.json();
  if (!balanceResponse.ok || balance.livemode !== false) throw new Error("Stripe test mode not proven");
  return { accountId: account.id, livemode: false };
}

export function assertOperationScope(operationId, allowedOperation) {
  if (!/^lab-[a-z0-9-]{1,70}$/.test(allowedOperation ?? "") || operationId !== allowedOperation) {
    throw new Error("Operation outside the single authorised test scope");
  }
}
