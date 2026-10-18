const test = require('node:test');
const assert = require('node:assert/strict');
const { fcmConfiguration } = require('../src/fcm');

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
