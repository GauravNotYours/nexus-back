const test = require('node:test');
const assert = require('node:assert/strict');
const { explainTwilioError, mapProviderStatus, normalizePhoneNumber, smsConfiguration } = require('../src/sms');

test('phone numbers are normalized for Twilio', () => {
  assert.equal(normalizePhoneNumber('98765 43210'), '+919876543210');
  assert.equal(normalizePhoneNumber('09876543210'), '+919876543210');
  assert.equal(normalizePhoneNumber('+1 (415) 555-0132'), '+14155550132');
  assert.equal(normalizePhoneNumber('0091 98765 43210'), '+919876543210');
});

test('invalid phone numbers fail with a useful validation message', () => {
  assert.throws(() => normalizePhoneNumber('call my friend'), /Enter a phone number/);
  assert.throws(() => normalizePhoneNumber('123'), /not valid in international E\.164 format/);
});

test('provider states are not presented as delivery until delivered', () => {
  assert.equal(mapProviderStatus('queued'), 'QUEUED');
  assert.equal(mapProviderStatus('sent'), 'SENT');
  assert.equal(mapProviderStatus('delivered'), 'DELIVERED');
  assert.equal(mapProviderStatus('undelivered'), 'FAILED');
});

test('SMS configuration reports missing Render environment variables', () => {
  assert.deepEqual(smsConfiguration({ TWILIO_ACCOUNT_SID: 'AC123' }).missing, [
    'TWILIO_AUTH_TOKEN',
    'TWILIO_FROM_NUMBER',
  ]);
  assert.equal(smsConfiguration({
    TWILIO_ACCOUNT_SID: 'AC123',
    TWILIO_AUTH_TOKEN: 'secret',
    TWILIO_FROM_NUMBER: '+15551234567',
  }).enabled, true);
});

test('trial-recipient and blocked-country errors explain how to fix Twilio settings', () => {
  assert.match(explainTwilioError({ code: 21608 }, '+919876543210'), /verified recipients/);
  assert.match(explainTwilioError({ code: 21408 }, '+919876543210'), /destination country/);
});
