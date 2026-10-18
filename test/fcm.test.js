const test = require('node:test');
const assert = require('node:assert/strict');
const { fcmConfiguration, registeredPushTokens, sendPush } = require('../src/fcm');

test('FCM configuration reports missing Firebase service-account values', () => {
  assert.deepEqual(fcmConfiguration({ FCM_PROJECT_ID: 'suraksha-test' }).missing, [
    'FCM_CLIENT_EMAIL',
    'FCM_PRIVATE_KEY',
  ]);
  assert.equal(fcmConfiguration({
    FCM_PROJECT_ID: 'suraksha-test',
    FCM_CLIENT_EMAIL: 'firebase-adminsdk@example.iam.gserviceaccount.com',
    FCM_PRIVATE_KEY: 'private-key',
  }).enabled, true);
});

test('registered push tokens tolerate missing or malformed legacy device arrays', () => {
  assert.deepEqual(registeredPushTokens(null), []);
  assert.deepEqual(registeredPushTokens({}), []);
  assert.deepEqual(registeredPushTokens({ pushTokens: [null, {}, { token: '' }, { token: 'token-123' }] }), ['token-123']);
});

test('sendPush rejects an invalid token-list shape instead of reading length on undefined', async () => {
  await assert.rejects(sendPush(undefined, {}), {
    name: 'TypeError',
    message: 'FCM device tokens must be an array.',
  });
});
