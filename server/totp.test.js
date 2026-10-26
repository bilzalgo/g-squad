import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTotpSecret, provisioningUri, verifyTotp } from './totp.js';

const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

test('verifies a six-digit authenticator code for the RFC SHA-1 test vector', () => {
  assert.equal(verifyTotp(rfcSecret, '287082', 59_000), 1);
});

test('rejects malformed, invalid, and wrong-time codes', () => {
  assert.equal(verifyTotp(rfcSecret, '28708', 59_000), null);
  assert.equal(verifyTotp(rfcSecret, '287083', 59_000), null);
  assert.equal(verifyTotp(rfcSecret, '287082', 120_000), null);
});

test('creates a Google Authenticator-compatible provisioning URI', () => {
  const secret = generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]{32}$/);
  const uri = new URL(provisioningUri(secret, 'GSQ-CEO-ONE'));
  assert.equal(uri.protocol, 'otpauth:');
  assert.equal(uri.searchParams.get('secret'), secret);
  assert.equal(uri.searchParams.get('issuer'), 'G-Squad');
  assert.equal(uri.searchParams.get('digits'), '6');
});
