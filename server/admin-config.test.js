import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInvestorProfile, normalizeSettingValue } from './admin-config.js';

test('normalizes optional investor profile fields and email casing', () => {
  assert.deepEqual(normalizeInvestorProfile({
    displayName: '  Sam Investor ',
    username: ' sam.i ',
    email: ' SAM@example.com ',
    phone: '+1 555 123 4567',
    country: 'Canada',
  }), {
    displayName: 'Sam Investor',
    username: 'sam.i',
    email: 'sam@example.com',
    phone: '+1 555 123 4567',
    country: 'Canada',
  });
  assert.equal(normalizeInvestorProfile({ displayName: 'Sam' }).email, null);
});

test('rejects invalid profile data', () => {
  assert.throws(() => normalizeInvestorProfile({ displayName: 'S', email: 'bad' }), /Display name/);
  assert.throws(() => normalizeInvestorProfile({ displayName: 'Sam', username: 'x!' }), /Username/);
  assert.throws(() => normalizeInvestorProfile({ displayName: 'Sam', email: 'bad' }), /email address/);
  assert.throws(() => normalizeInvestorProfile({ displayName: 'Sam', phone: 'abc' }), /Phone number/);
  assert.throws(() => normalizeInvestorProfile({ displayName: 'Sam', phone: '-------' }), /Phone number/);
});

test('validates only whitelisted setting types and values', () => {
  assert.equal(normalizeSettingValue('dashboard_notice_enabled', true), true);
  assert.equal(normalizeSettingValue('dashboard_notice', '  Scheduled update  '), 'Scheduled update');
  assert.throws(() => normalizeSettingValue('DERIV_API_TOKEN', 'secret'), /cannot be changed/);
  assert.throws(() => normalizeSettingValue('dashboard_notice_enabled', 'true'), /enabled or disabled/);
  assert.throws(() => normalizeSettingValue('dashboard_notice', 'x'.repeat(501)), /500 characters/);
});

test('normalizes CEO trading configuration drafts without accepting execution controls', () => {
  assert.deepEqual(normalizeSettingValue('trading_configuration', {
    strategy: '  Review strategy  ',
    permittedMarkets: ['  EUR/USD  ', 'BTC/USD'],
    permittedContracts: [' Rise/Fall '],
    recoveryEnabled: true,
    recoveryMultiplier: '2.5',
  }), {
    strategy: 'Review strategy',
    permittedMarkets: ['EUR/USD', 'BTC/USD'],
    permittedContracts: ['Rise/Fall'],
    recoveryEnabled: true,
    recoveryMultiplier: '2.5',
  });
  assert.throws(() => normalizeSettingValue('trading_configuration', {
    strategy: '',
    permittedMarkets: [],
    permittedContracts: [],
    recoveryEnabled: true,
    recoveryMultiplier: '',
  }), /positive recovery multiplier/);
  assert.throws(() => normalizeSettingValue('trading_configuration', {
    strategy: '',
    permittedMarkets: [],
    permittedContracts: [],
    recoveryEnabled: false,
    recoveryMultiplier: '',
    liveTradingEnabled: true,
  }), /unsupported field/);
});
