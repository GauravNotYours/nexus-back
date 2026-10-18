const admin = require('firebase-admin');

function fcmConfiguration(env = process.env) {
  const required = ['FCM_PROJECT_ID', 'FCM_CLIENT_EMAIL', 'FCM_PRIVATE_KEY'];
  const missing = required.filter((key) => !String(env[key] || '').trim());
  return { enabled: missing.length === 0, missing };
}

function registeredPushTokens(user) {
  const devices = Array.isArray(user && user.pushTokens) ? user.pushTokens : [];
  return devices
    .map((device) => device && device.token)
    .filter((token) => typeof token === 'string' && token.trim().length > 0);
}

function firebaseMessaging(env = process.env) {
  const config = fcmConfiguration(env);
  if (!config.enabled) {
    throw new Error(`FCM is not configured. Missing environment variables: ${config.missing.join(', ')}.`);
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: env.FCM_PROJECT_ID,
        clientEmail: env.FCM_CLIENT_EMAIL,
        privateKey: env.FCM_PRIVATE_KEY.replace(/\\n/g, '\n'),
      }),
    });
  }
  return admin.messaging();
}

async function sendPush(tokens, { title, body, url, emergencyId }, env = process.env) {
  if (!Array.isArray(tokens)) throw new TypeError('FCM device tokens must be an array.');
  if (!tokens.length) return { successCount: 0, failureCount: 0, invalidTokens: [], errors: [] };
  const response = await firebaseMessaging(env).sendEachForMulticast({
    tokens,
    notification: { title, body },
    data: { url: url || '', emergencyId: emergencyId || '' },
    android: { priority: 'high', notification: { channelId: 'emergency' } },
  });
  if (!response || !Array.isArray(response.responses)) {
    throw new Error('Firebase returned an invalid multicast response.');
  }
  const invalidTokens = [];
  const errors = [];
  response.responses.forEach((result, index) => {
    if (result.success) return;
    const code = result.error && result.error.code;
    if (code === 'messaging/invalid-registration-token' || code === 'messaging/registration-token-not-registered') {
      invalidTokens.push(tokens[index]);
    }
    errors.push(result.error && result.error.message || 'Firebase rejected a push notification.');
  });
  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    invalidTokens,
    errors,
  };
}

module.exports = { fcmConfiguration, registeredPushTokens, sendPush };
