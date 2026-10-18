const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { fcmConfiguration, firebaseMessaging, registeredPushTokens, sendPush, sendPushWithMessaging } = require('../src/fcm');

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

test('Firebase Admin SDK initializes its default app using the supported app registry API', () => {
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  });
  const messaging = firebaseMessaging({
    FCM_PROJECT_ID: 'suraksha-test',
    FCM_CLIENT_EMAIL: 'firebase-adminsdk@example.iam.gserviceaccount.com',
    FCM_PRIVATE_KEY: privateKey,
  });
  assert.equal(typeof messaging.send, 'function');
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

test('push messages are sent individually and aggregate per-device results', async () => {
  const sent = [];
  const result = await sendPushWithMessaging(['token-a', 'token-b'], {
    title: 'SOS',
    body: 'Help needed',
    url: 'https://example.test/location',
    emergencyId: 'emergency-1',
  }, {
    async send(message) {
      sent.push(message);
      if (message.token === 'token-b') {
        const error = new Error('Token is no longer registered.');
        error.code = 'messaging/registration-token-not-registered';
        throw error;
      }
      return 'projects/test/messages/123';
    },
  });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].notification.title, 'SOS');
  assert.equal(sent[0].data.url, 'https://example.test/location');
  assert.deepEqual(result, {
    successCount: 1,
    failureCount: 1,
    invalidTokens: ['token-b'],
    errors: ['Token is no longer registered.'],
  });
});
