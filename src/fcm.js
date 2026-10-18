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

async function sendPushWithMessaging(tokens, { title, body, url, emergencyId }, messaging) {
  if (!Array.isArray(tokens)) throw new TypeError('FCM device tokens must be an array.');
  if (!tokens.length) return { successCount: 0, failureCount: 0, invalidTokens: [], errors: [] };
  if (tokens.length > 500) throw new RangeError('Firebase accepts at most 500 device tokens per send.');
  const results = await Promise.all(tokens.map(async (token) => {
    try {
      await messaging.send({
        token,
        notification: { title, body },
        data: { url: url || '', emergencyId: emergencyId || '' },
        android: { priority: 'high', notification: { channelId: 'emergency' } },
      });
      return { token, success: true };
    } catch (error) {
      return { token, success: false, error };
    }
  }));
  const invalidTokens = [];
  const errors = [];
  results.forEach((result) => {
    if (result.success) return;
    const code = result.error && result.error.code;
    if (code === 'messaging/invalid-registration-token' || code === 'messaging/registration-token-not-registered') {
      invalidTokens.push(result.token);
    }
    errors.push(result.error && result.error.message || 'Firebase rejected a push notification.');
  });
  return {
    successCount: results.filter((result) => result.success).length,
    failureCount: results.filter((result) => !result.success).length,
    invalidTokens,
    errors,
  };
}

async function sendPush(tokens, payload, env = process.env) {
  if (!Array.isArray(tokens)) throw new TypeError('FCM device tokens must be an array.');
  if (!tokens.length) return { successCount: 0, failureCount: 0, invalidTokens: [], errors: [] };
  return sendPushWithMessaging(tokens, payload, firebaseMessaging(env));
}

module.exports = { fcmConfiguration, registeredPushTokens, sendPush, sendPushWithMessaging };
