import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchingReceipt, assertReadback } from './acceptance.mjs';

const operationId = 'lab-unit-evidence';
function fixture(mode = 'fixture') {
  const receipt = { operationId, id: mode === 'fixture' ? 'fixture_pi_abcdef012345' : 'pi_TESTONLY123',
    mode, livemode: false, status: 'succeeded' };
  return {
    agent: { toolExecutions: 1, providerReceipt: structuredClone(receipt) },
    gateway: { mode, gatewayRequests: 1, stripeCreateRequests: mode === 'fixture' ? 0 : 1,
      accepted: { [operationId]: structuredClone(receipt) } }
  };
}

test('matching fixture receipt is accepted without claiming Stripe verification', () => {
  const { agent, gateway } = fixture();
  const receipt = assertMatchingReceipt(agent, gateway, operationId, 'fixture');
  assertReadback({ verified: false, reason: 'fixture_only' }, receipt, 'fixture');
});

test('matching synthetic Stripe-shaped records validate schema only', () => {
  const { agent, gateway } = fixture('stripe-test');
  const receipt = assertMatchingReceipt(agent, gateway, operationId, 'stripe-test');
  assertReadback({ verified: true, mode: 'stripe-test', id: receipt.id,
    livemode: false, status: 'succeeded', metadataMatches: true }, receipt, 'stripe-test');
});

for (const [name, change] of [
  ['duplicate tool execution', (a, g) => { a.toolExecutions = 2; }],
  ['duplicate gateway call', (a, g) => { g.gatewayRequests = 2; }],
  ['real Stripe call during fixture', (a, g) => { g.stripeCreateRequests = 1; }],
  ['gateway mode mismatch', (a, g) => { g.mode = 'stripe-test'; }],
  ['missing gateway receipt', (a, g) => { delete g.accepted[operationId]; }],
  ['receipt for different operation', (a, g) => { g.accepted[operationId].operationId = 'lab-other'; }],
  ['receipt mode mismatch', (a, g) => { g.accepted[operationId].mode = 'stripe-test'; }],
  ['live-mode receipt', (a, g) => { g.accepted[operationId].livemode = true; }],
  ['unconfirmed effect', (a, g) => { g.accepted[operationId].status = 'attempt_committed'; }],
  ['invalid provider identifier', (a, g) => { g.accepted[operationId].id = 'pi_wrongmode'; }],
  ['Pi receipt does not match provider', (a, g) => { a.providerReceipt.id = 'fixture_pi_000000'; }]
]) {
  test('rejects ' + name, () => {
    const { agent, gateway } = fixture();
    change(agent, gateway);
    assert.throws(() => assertMatchingReceipt(agent, gateway, operationId, 'fixture'));
  });
}

test('fixture readback cannot be labelled verified', () => {
  const { agent, gateway } = fixture();
  const receipt = assertMatchingReceipt(agent, gateway, operationId, 'fixture');
  assert.throws(() => assertReadback({ verified: true, reason: 'fixture_only' }, receipt, 'fixture'));
});

for (const [field, value] of [
  ['verified', false], ['mode', 'fixture'], ['id', 'pi_OTHERTEST123'],
  ['livemode', true], ['status', 'requires_payment_method'], ['metadataMatches', false]
]) {
  test('rejects Stripe-shaped readback with incorrect ' + field, () => {
    const { agent, gateway } = fixture('stripe-test');
    const receipt = assertMatchingReceipt(agent, gateway, operationId, 'stripe-test');
    const readback = { verified: true, mode: 'stripe-test', id: receipt.id,
      livemode: false, status: 'succeeded', metadataMatches: true, [field]: value };
    assert.throws(() => assertReadback(readback, receipt, 'stripe-test'));
  });
}
