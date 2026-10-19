import assert from 'node:assert/strict';

/** Evidence checks only: no provider calls, credentials, or execution authority. */
export function assertMatchingReceipt(agent, gateway, operationId, mode) {
  assert.ok(['fixture', 'stripe-test'].includes(mode), 'Unsupported evidence mode');
  assert.equal(agent.toolExecutions, 1, 'Unexpected tool execution count');
  assert.equal(gateway.mode, mode, 'Gateway evidence belongs to another mode');
  assert.equal(gateway.gatewayRequests, 1, 'Unexpected gateway request count');
  assert.equal(gateway.stripeCreateRequests, mode === 'stripe-test' ? 1 : 0,
    'Unexpected real Stripe create request count');
  const receipt = gateway.accepted?.[operationId];
  assert.ok(receipt, 'No gateway receipt for the exact operation');
  assert.equal(receipt.operationId, operationId, 'Receipt operation mismatch');
  assert.equal(receipt.mode, mode, 'Receipt mode mismatch');
  assert.equal(receipt.livemode, false, 'Only test evidence is allowed');
  assert.equal(receipt.status, 'succeeded', 'External effect is not confirmed');
  assert.equal(typeof receipt.id, 'string', 'Missing provider identifier');
  assert.match(receipt.id, mode === 'stripe-test' ? /^pi_[A-Za-z0-9]+$/ : /^fixture_pi_[a-f0-9]+$/,
    'Provider identifier does not match evidence mode');
  assert.deepEqual(agent.providerReceipt, {
    operationId, id: receipt.id, status: receipt.status, mode: receipt.mode,
    livemode: receipt.livemode
  }, 'Pi and gateway disagree on the external receipt');
  return receipt;
}

export function assertReadback(verification, receipt, mode) {
  if (mode === 'fixture') {
    assert.equal(verification.verified, false, 'Fixture must not claim provider verification');
    assert.equal(verification.reason, 'fixture_only', 'Fixture evidence must remain explicitly labelled');
    return;
  }
  assert.equal(mode, 'stripe-test', 'Unsupported evidence mode');
  assert.equal(verification.verified, true, 'No successful Stripe readback');
  assert.equal(verification.mode, 'stripe-test', 'Readback mode mismatch');
  assert.equal(verification.id, receipt.id, 'Readback concerns another PaymentIntent');
  assert.equal(verification.livemode, false, 'Readback must be test mode');
  assert.equal(verification.status, 'succeeded', 'Stripe payment not successful');
  assert.equal(verification.metadataMatches, true, 'Stripe metadata mismatch');
}
