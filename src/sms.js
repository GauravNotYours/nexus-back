function normalizePhoneNumber(input, defaultCountryCode = '+91') {
  const original = String(input || '').trim();
  if (!original || /[^\d+\s().-]/.test(original)) {
    throw new Error('Enter a phone number using digits and an optional country code.');
  }

  let normalized = original.replace(/[\s().-]/g, '');
  if (normalized.startsWith('00')) normalized = `+${normalized.slice(2)}`;

  if (!normalized.startsWith('+')) {
    let digits = normalized.replace(/\D/g, '');
    const countryCode = String(defaultCountryCode).replace(/\D/g, '');
    if (!countryCode || countryCode.length > 3) throw new Error('SMS_DEFAULT_COUNTRY_CODE must be a country calling code, such as +91.');
    digits = digits.replace(/^0+/, '');
    if (digits.startsWith(countryCode) && digits.length > 10) normalized = `+${digits}`;
    else normalized = `+${countryCode}${digits}`;
  }

  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error(`Phone number "${original}" is not valid in international E.164 format. Include the country code, such as +919876543210.`);
  }
  return normalized;
}

function mapProviderStatus(status) {
  if (status === 'delivered' || status === 'read') return 'DELIVERED';
  if (status === 'sent') return 'SENT';
  if (status === 'failed' || status === 'undelivered' || status === 'canceled') return 'FAILED';
  return 'QUEUED';
}

function smsConfiguration(env = process.env) {
  const required = ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_FROM_NUMBER'];
  const missing = required.filter((key) => !String(env[key] || '').trim());
  return {
    enabled: missing.length === 0,
    missing,
    defaultCountryCode: env.SMS_DEFAULT_COUNTRY_CODE || '+91',
  };
}

function explainTwilioError(error, recipient) {
  const code = String(error && error.code || '');
  const providerMessage = String(error && error.message || '');
  const normalizedMessage = providerMessage.toLowerCase();
  if (
    normalizedMessage.includes('invalid template name')
    || (normalizedMessage.includes('trial account') && normalizedMessage.includes('predefined') && normalizedMessage.includes('template'))
  ) {
    return 'The SMS provider rejected this custom safety-alert message because this trial account only permits predefined SMS templates. Suraksha sends a personalized alert with a live-location link, which cannot be replaced with a generic trial template. Upgrade the provider account or configure an approved template that supports these alert details, then retry.';
  }
  if (code === '21608') {
    return `Twilio trial accounts can only message verified recipients. Verify ${recipient} in the Twilio Console under Phone Numbers > Manage > Verified Caller IDs, or upgrade the Twilio account.`;
  }
  if (code === '21408') {
    return `Twilio is not enabled to send messages to this destination country. Enable the destination under Twilio Console > Messaging > Settings > Geo Permissions.`;
  }
  if (code === '21211') {
    return `Twilio rejected recipient number ${recipient}. Check that it is a valid number with its country code.`;
  }
  if (code === '21606' || code === '21659') {
    return 'Twilio rejected the sender number. Confirm TWILIO_FROM_NUMBER is an active SMS-capable Twilio number.';
  }
  return providerMessage || 'Twilio rejected the SMS request.';
}

module.exports = { normalizePhoneNumber, mapProviderStatus, smsConfiguration, explainTwilioError };
