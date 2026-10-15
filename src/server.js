require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const twilio = require('twilio');
const crypto = require('crypto');
const {
  User, TrustedContact, EmergencyService, RiskZone, Notification, Emergency, Journey,
} = require('./models');

const app = express();
app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || '*', credentials: false }));
app.use(express.json({ limit: '32kb' }));
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 }));

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const fail = (status, message) => Object.assign(new Error(message), { status });
const validId = (id) => mongoose.isValidObjectId(id);
const publicBaseUrl = () => new URL(process.env.PUBLIC_BASE_URL).origin;
const asPublicUser = (user) => ({
  id: String(user._id), name: user.name, email: user.email, phone: user.phone,
  bloodType: user.bloodType, medicalNotes: user.medicalNotes,
});
const coordinates = (value) => {
  const lat = Number(value && value.lat);
  const lng = Number(value && value.lng);
  const accuracyMeters = value && Number(value.accuracyMeters);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw fail(400, 'Valid latitude and longitude are required.');
  }
  return { lat, lng, ...(Number.isFinite(accuracyMeters) && accuracyMeters >= 0 ? { accuracyMeters } : {}) };
};
const distanceKm = (a, b) => {
  const radians = (degrees) => degrees * Math.PI / 180;
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return next(fail(401, 'Authentication required.'));
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.sub;
    return next();
  } catch {
    return next(fail(401, 'Session is invalid or expired. Please sign in again.'));
  }
}
const tokenFor = (user) => jwt.sign({ sub: String(user._id) }, process.env.JWT_SECRET, { expiresIn: '30d' });
const objectId = (value) => {
  if (!validId(value)) throw fail(400, 'Invalid resource id.');
  return value;
};

async function notifyContact(ownerId, contact, message, related = {}) {
  const log = {
    owner: ownerId, contact: contact && contact._id, ...related, channel: 'SMS',
    status: 'QUEUED', message,
  };
  const ready = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER;
  if (ready && contact) {
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const sent = await client.messages.create({
        body: message, from: process.env.TWILIO_FROM_NUMBER, to: contact.phone,
      });
      log.status = 'SENT';
      log.providerId = sent.sid;
    } catch (error) {
      log.status = 'FAILED';
      log.error = error.message;
      console.error('SMS delivery failed:', error.message);
    }
  } else if (!contact) {
    log.status = 'FAILED';
    log.error = 'No eligible trusted contact is configured.';
  }
  await Notification.create(log);
  return { name: contact ? contact.name : '', phone: contact ? contact.phone : '', status: log.status };
}

const router = express.Router();

router.get('/health', (req, res) => res.json({ status: 'ok', database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected' }));

router.post('/auth/register', asyncRoute(async (req, res) => {
  const { name, email, phone, password, emergencyPin } = req.body || {};
  if (!name || !email || !phone || !password || !emergencyPin) throw fail(400, 'Name, email, phone, password, and a 4-digit emergency PIN are required.');
  if (String(password).length < 8) throw fail(400, 'Password must be at least 8 characters.');
  if (!/^\d{4}$/.test(String(emergencyPin))) throw fail(400, 'Emergency PIN must contain exactly 4 digits.');
  if (await User.exists({ email: String(email).trim().toLowerCase() })) throw fail(409, 'An account already exists for this email.');
  const user = await User.create({
    name, email, phone, passwordHash: await bcrypt.hash(password, 12),
    emergencyPinHash: await bcrypt.hash(emergencyPin, 12),
  });
  res.status(201).json({ user: asPublicUser(user), token: tokenFor(user) });
}));

router.post('/auth/login', asyncRoute(async (req, res) => {
  const identifier = String((req.body || {}).identifier || '').trim();
  const user = await User.findOne({
    $or: [{ email: identifier.toLowerCase() }, { phone: identifier }],
  }).select('+passwordHash');
  if (!user || !await bcrypt.compare(String((req.body || {}).password || ''), user.passwordHash)) throw fail(401, 'Email/phone or password is incorrect.');
  res.json({ user: asPublicUser(user), token: tokenFor(user) });
}));

router.get('/auth/me', auth, asyncRoute(async (req, res) => {
  const user = await User.findById(req.userId);
  if (!user) throw fail(404, 'User account was not found.');
  res.json(asPublicUser(user));
}));

router.put('/auth/profile', auth, asyncRoute(async (req, res) => {
  const allowed = ['name', 'phone', 'bloodType', 'medicalNotes'];
  const updates = {};
  for (const field of allowed) if (req.body && req.body[field] !== undefined) updates[field] = req.body[field];
  const user = await User.findByIdAndUpdate(req.userId, updates, { new: true, runValidators: true });
  res.json(asPublicUser(user));
}));

router.put('/auth/pin', auth, asyncRoute(async (req, res) => {
  const { currentPin, newPin } = req.body || {};
  if (!/^\d{4}$/.test(String(newPin || ''))) throw fail(400, 'New PIN must contain exactly 4 digits.');
  const user = await User.findById(req.userId).select('+emergencyPinHash');
  if (!await bcrypt.compare(String(currentPin || ''), user.emergencyPinHash)) throw fail(401, 'Current PIN is incorrect.');
  user.emergencyPinHash = await bcrypt.hash(newPin, 12);
  await user.save();
  res.json({ message: 'Emergency PIN updated.' });
}));

router.get('/contacts', auth, asyncRoute(async (req, res) => {
  res.json(await TrustedContact.find({ owner: req.userId }).sort({ isPrimary: -1, createdAt: 1 }));
}));

router.post('/contacts', auth, asyncRoute(async (req, res) => {
  const { name, phone, relationship, isPrimary, notifyOnMissedCheckIn, notifyOnSOS } = req.body || {};
  if (!name || !phone) throw fail(400, 'Contact name and phone are required.');
  if (isPrimary) await TrustedContact.updateMany({ owner: req.userId }, { isPrimary: false });
  const contact = await TrustedContact.create({
    owner: req.userId, name, phone, relationship, isPrimary: Boolean(isPrimary),
    notifyOnMissedCheckIn: notifyOnMissedCheckIn !== false, notifyOnSOS: notifyOnSOS !== false,
  });
  res.status(201).json(contact);
}));

router.put('/contacts/:id', auth, asyncRoute(async (req, res) => {
  const id = objectId(req.params.id);
  const allowed = ['name', 'phone', 'relationship', 'isPrimary', 'notifyOnMissedCheckIn', 'notifyOnSOS'];
  const updates = {};
  for (const field of allowed) if (req.body && req.body[field] !== undefined) updates[field] = req.body[field];
  if (updates.isPrimary) await TrustedContact.updateMany({ owner: req.userId }, { isPrimary: false });
  const contact = await TrustedContact.findOneAndUpdate({ _id: id, owner: req.userId }, updates, { new: true, runValidators: true });
  if (!contact) throw fail(404, 'Trusted contact not found.');
  res.json(contact);
}));

router.delete('/contacts/:id', auth, asyncRoute(async (req, res) => {
  const contact = await TrustedContact.findOneAndDelete({ _id: objectId(req.params.id), owner: req.userId });
  if (!contact) throw fail(404, 'Trusted contact not found.');
  res.json({ message: 'Contact deleted.' });
}));

router.post('/contacts/:id/test-ping', auth, asyncRoute(async (req, res) => {
  const contact = await TrustedContact.findOne({ _id: objectId(req.params.id), owner: req.userId });
  if (!contact) throw fail(404, 'Trusted contact not found.');
  const owner = await User.findById(req.userId);
  const sent = await notifyContact(req.userId, contact, `Suraksha test: ${owner.name} has added you as a safety contact.`);
  res.json({ message: sent.status === 'SENT' ? 'Test SMS sent.' : 'Notification recorded; configure Twilio to deliver SMS.', status: sent.status });
}));

router.post('/services/nearby', auth, asyncRoute(async (req, res) => {
  const point = coordinates(req.body);
  const services = await EmergencyService.find().lean();
  res.json(services.map((service) => ({
    id: String(service._id), name: service.name, type: service.type, phone: service.phone,
    address: service.address, details: service.details, isOpen24x7: service.isOpen24x7,
    distanceKm: Number(distanceKm(point, service.location).toFixed(2)),
  })).sort((a, b) => a.distanceKm - b.distanceKm));
}));

router.get('/public/emergencies/:token', asyncRoute(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!/^[a-f0-9]{64}$/.test(req.params.token)) throw fail(404, 'Location share not found or expired.');
  const emergency = await Emergency.findOne({
    shareToken: req.params.token, status: 'ACTIVE', shareExpiresAt: { $gt: new Date() },
  }).select('+shareToken').lean();
  if (!emergency) throw fail(404, 'Location share not found or expired.');
  if (req.query.format === 'json') {
    return res.json({
      status: emergency.status, coordinates: emergency.coordinates,
      activatedAt: emergency.activatedAt, updatedAt: emergency.updatedAt,
    });
  }
  res.set('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
  res.type('html').send(`<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><meta charset="utf-8"><title>Suraksha live location</title><body style="font:16px system-ui;max-width:560px;margin:40px auto;padding:0 20px;color:#241512"><h1>Suraksha live location</h1><p id="state">Loading latest location…</p><a id="map" rel="noopener noreferrer" target="_blank">Open latest position in Google Maps</a><p>Location refreshes every 20 seconds while the alert is active.</p><script>const state=document.getElementById('state'),map=document.getElementById('map');async function update(){try{const r=await fetch(location.pathname+'?format=json',{cache:'no-store'});if(!r.ok){state.textContent='This location share has expired or the alert is no longer active.';map.hidden=true;return}const d=await r.json();if(!d.coordinates){state.textContent='The user has not shared a GPS fix yet.';return}const p=d.coordinates;state.textContent='Last location update: '+new Date(d.updatedAt).toLocaleString()+' · '+p.lat.toFixed(5)+', '+p.lng.toFixed(5);map.href='https://maps.google.com/?q='+encodeURIComponent(p.lat+','+p.lng)}catch{state.textContent='Unable to refresh. Check your connection.'}}update();setInterval(update,20000)</script></body></html>`);
}));

router.post('/safety/score', auth, asyncRoute(async (req, res) => {
  const point = coordinates(req.body);
  const zones = await RiskZone.find({ active: true, $or: [{ validUntil: null }, { validUntil: { $gt: new Date() } }] }).lean();
  const matches = zones.filter((zone) => distanceKm(point, zone.center) * 1000 <= zone.radiusMeters);
  const levelRank = { LOW: 1, MODERATE: 2, HIGH: 3 };
  const highest = matches.reduce((level, zone) => levelRank[zone.level] > levelRank[level] ? zone.level : level, 'LOW');
  const serviceCount = await EmergencyService.countDocuments();
  const score = matches.length
    ? Math.max(0, Math.min(100, 95 - (highest === 'HIGH' ? 50 : highest === 'MODERATE' ? 25 : 0)))
    : null;
  res.json({
    score, riskLevel: matches.length ? (highest === 'LOW' ? 'Low Risk' : highest === 'MODERATE' ? 'Moderate Risk' : 'High Risk') : 'No recent risk reports',
    status: highest === 'HIGH' ? 'WARNING' : 'MONITORED', coordinates: point,
    factors: { positive: serviceCount ? [`${serviceCount} emergency service records are available in the directory.`] : [], cautions: matches.map((zone) => zone.description) },
    lastEvaluated: new Date().toISOString(),
  });
}));

router.post('/emergency/sos', auth, asyncRoute(async (req, res) => {
  const point = req.body && req.body.coordinates ? coordinates(req.body.coordinates) : undefined;
  const shareToken = crypto.randomBytes(32).toString('hex');
  const emergency = await Emergency.create({
    owner: req.userId, ...(point ? { coordinates: point } : {}), shareToken,
    shareExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    source: req.body && req.body.source === 'VOICE' ? 'VOICE' : 'SOS',
  });
  const owner = await User.findById(req.userId);
  const contacts = await TrustedContact.find({ owner: req.userId, notifyOnSOS: true }).sort({ isPrimary: -1 });
  const shareUrl = `${publicBaseUrl()}/api/public/emergencies/${shareToken}`;
  const message = `SOS: ${owner.name} needs help. View their live location (expires in 24 hours): ${shareUrl}`;
  const notifications = await Promise.all(contacts.map((contact) => notifyContact(req.userId, contact, message, { emergency: emergency._id })));
  res.status(201).json({
    _id: String(emergency._id), emergencyId: String(emergency._id), activatedAt: emergency.activatedAt,
    status: 'ACTIVE', ...(point ? { coordinates: point } : {}), shareUrl, contactsNotified: notifications,
  });
}));

router.put('/emergency/:id/location', auth, asyncRoute(async (req, res) => {
  const emergency = await Emergency.findOne({ _id: objectId(req.params.id), owner: req.userId, status: 'ACTIVE' });
  if (!emergency) throw fail(404, 'Active emergency was not found.');
  emergency.coordinates = coordinates(req.body && (req.body.coordinates || req.body));
  await emergency.save();
  res.json({ emergencyId: String(emergency._id), coordinates: emergency.coordinates, updatedAt: emergency.updatedAt });
}));

router.get('/emergency/active', auth, asyncRoute(async (req, res) => {
  const emergency = await Emergency.findOne({ owner: req.userId, status: 'ACTIVE' }).select('+shareToken').sort({ activatedAt: -1 });
  if (!emergency) return res.json(null);
  const record = emergency.toObject();
  const shareToken = record.shareToken;
  delete record.shareToken;
  res.json({
    ...record,
    shareUrl: shareToken ? `${publicBaseUrl()}/api/public/emergencies/${shareToken}` : undefined,
  });
}));

router.post('/emergency/:id/cancel', auth, asyncRoute(async (req, res) => {
  const emergency = await Emergency.findOne({ _id: objectId(req.params.id), owner: req.userId, status: 'ACTIVE' });
  if (!emergency) throw fail(404, 'Active emergency was not found.');
  const user = await User.findById(req.userId).select('+emergencyPinHash');
  if (!await bcrypt.compare(String((req.body || {}).pin || ''), user.emergencyPinHash)) throw fail(401, 'Emergency PIN is incorrect.');
  emergency.status = 'CANCELLED';
  emergency.resolvedAt = new Date();
  await emergency.save();
  const contacts = await TrustedContact.find({ owner: req.userId, notifyOnSOS: true });
  await Promise.all(contacts.map((contact) => notifyContact(req.userId, contact, `Safety update: ${user.name} has cancelled/resolved the SOS alert.`, { emergency: emergency._id })));
  res.json({ message: 'SOS resolved. A safety update was recorded for your contacts.' });
}));

router.post('/journeys', auth, asyncRoute(async (req, res) => {
  const { origin, destination, routeName, estimatedMinutes, checkInIntervalMinutes, trustedContactId, currentLocation } = req.body || {};
  if (!origin || !destination || !Number.isFinite(Number(estimatedMinutes)) || Number(estimatedMinutes) < 1) throw fail(400, 'Origin, destination, and a positive estimated duration are required.');
  const contact = await TrustedContact.findOne({ _id: objectId(trustedContactId), owner: req.userId });
  if (!contact) throw fail(400, 'Select a trusted contact before starting a journey.');
  const duration = Math.min(1440, Number(estimatedMinutes));
  const interval = Math.min(1440, Math.max(1, Number(checkInIntervalMinutes) || Math.max(5, Math.floor(duration / 2))));
  const now = new Date();
  const journey = await Journey.create({
    owner: req.userId, origin, destination, routeName: routeName || '',
    estimatedMinutes: duration, checkInIntervalMinutes: interval, trustedContact: contact._id,
    startedAt: now, expectedArrivalAt: new Date(now.getTime() + duration * 60000),
    nextCheckInAt: new Date(now.getTime() + interval * 60000),
    currentLocation: currentLocation ? coordinates(currentLocation) : undefined,
  });
  res.status(201).json(journey);
}));

router.get('/journeys/active', auth, asyncRoute(async (req, res) => {
  res.json(await Journey.findOne({ owner: req.userId, status: { $in: ['ACTIVE', 'MISSED_CHECKIN'] } }).populate('trustedContact', 'name phone'));
}));

router.get('/journeys/history', auth, asyncRoute(async (req, res) => {
  const journeys = await Journey.find({ owner: req.userId, status: { $in: ['COMPLETED', 'CANCELLED', 'ESCALATED'] } }).sort({ startedAt: -1 }).limit(100).lean();
  res.json(journeys.map((journey) => ({
    id: String(journey._id), destination: journey.destination, date: journey.startedAt,
    durationMinutes: Math.max(0, Math.round(((journey.completedAt || journey.updatedAt) - journey.startedAt) / 60000)),
    safetyScore: journey.status === 'COMPLETED' ? 100 : 50, status: journey.status,
    checkInsCompleted: journey.checkInsCompleted,
  })));
}));

router.post('/journeys/:id/checkin', auth, asyncRoute(async (req, res) => {
  const journey = await Journey.findOne({ _id: objectId(req.params.id), owner: req.userId, status: { $in: ['ACTIVE', 'MISSED_CHECKIN'] } });
  if (!journey) throw fail(404, 'Active journey was not found.');
  journey.status = 'ACTIVE';
  journey.escalationLevel = 0;
  journey.escalationAt = undefined;
  journey.lastCheckInAt = new Date();
  journey.nextCheckInAt = new Date(Date.now() + journey.checkInIntervalMinutes * 60000);
  journey.checkInsCompleted += 1;
  if (req.body && req.body.currentLocation) journey.currentLocation = coordinates(req.body.currentLocation);
  await journey.save();
  res.json({ message: 'Safety check-in recorded.', journey });
}));

router.put('/journeys/:id/location', auth, asyncRoute(async (req, res) => {
  const journey = await Journey.findOne({ _id: objectId(req.params.id), owner: req.userId, status: { $in: ['ACTIVE', 'MISSED_CHECKIN'] } });
  if (!journey) throw fail(404, 'Active journey was not found.');
  journey.currentLocation = coordinates(req.body && (req.body.currentLocation || req.body));
  await journey.save();
  res.json({ message: 'Journey location updated.' });
}));

router.post('/journeys/:id/complete', auth, asyncRoute(async (req, res) => {
  const journey = await Journey.findOne({ _id: objectId(req.params.id), owner: req.userId, status: { $in: ['ACTIVE', 'MISSED_CHECKIN'] } });
  if (!journey) throw fail(404, 'Active journey was not found.');
  journey.status = 'COMPLETED';
  journey.completedAt = new Date();
  await journey.save();
  res.json({ message: 'Journey marked complete.' });
}));

router.post('/journeys/:id/cancel', auth, asyncRoute(async (req, res) => {
  const journey = await Journey.findOne({ _id: objectId(req.params.id), owner: req.userId, status: { $in: ['ACTIVE', 'MISSED_CHECKIN'] } });
  if (!journey) throw fail(404, 'Active journey was not found.');
  journey.status = 'CANCELLED';
  journey.completedAt = new Date();
  await journey.save();
  res.json({ message: 'Journey cancelled.' });
}));

router.get('/notifications', auth, asyncRoute(async (req, res) => {
  res.json(await Notification.find({ owner: req.userId }).sort({ createdAt: -1 }).limit(100));
}));

app.use('/api', router);
app.use((req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const status = error.status || (error.name === 'ValidationError' ? 400 : error.code === 11000 ? 409 : 500);
  if (status >= 500) console.error(error);
  res.status(status).json({ error: status >= 500 ? 'Internal server error.' : error.message });
});

async function processEscalations() {
  const now = new Date();
  const overdue = await Journey.find({ status: 'ACTIVE', nextCheckInAt: { $lte: now } }).limit(100);
  for (const journey of overdue) {
    const changed = await Journey.findOneAndUpdate(
      { _id: journey._id, status: 'ACTIVE', nextCheckInAt: { $lte: now } },
      { $set: { status: 'MISSED_CHECKIN', escalationLevel: 1, escalationAt: new Date(now.getTime() + Number(process.env.ESCALATION_GRACE_MINUTES || 2) * 60000) } },
      { new: true },
    );
    if (!changed) continue;
    const [owner, contact] = await Promise.all([
      User.findById(changed.owner),
      TrustedContact.findOne({ _id: changed.trustedContact, notifyOnMissedCheckIn: true }),
    ]);
    if (owner) {
      const last = changed.currentLocation;
      const mapLink = last ? ` Location: https://maps.google.com/?q=${last.lat},${last.lng}` : '';
      await notifyContact(changed.owner, contact, `Safety check-in missed: ${owner.name} has not checked in for their journey to ${changed.destination}.${mapLink}`, { journey: changed._id });
    }
  }
  const missed = await Journey.find({ status: 'MISSED_CHECKIN', escalationAt: { $lte: now } }).limit(100);
  for (const journey of missed) {
    const changed = await Journey.findOneAndUpdate(
      { _id: journey._id, status: 'MISSED_CHECKIN', escalationAt: { $lte: now } },
      { $set: { status: 'ESCALATED', escalationLevel: 3 } },
      { new: true },
    );
    if (!changed) continue;
    const shareToken = crypto.randomBytes(32).toString('hex');
    const emergency = await Emergency.create({
      owner: changed.owner, ...(changed.currentLocation ? { coordinates: changed.currentLocation } : {}),
      source: 'MISSED_CHECK_IN', journey: changed._id, shareToken,
      shareExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    const [owner, contacts] = await Promise.all([
      User.findById(changed.owner),
      TrustedContact.find({ owner: changed.owner, notifyOnSOS: true }),
    ]);
    if (owner) {
      const shareUrl = `${(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '')}/api/public/emergencies/${shareToken}`;
      const message = `URGENT: ${owner.name} did not respond to a safety check-in. Emergency escalation activated. Live location: ${shareUrl}`;
      await Promise.all(contacts.map((contact) => notifyContact(changed.owner, contact, message, { journey: changed._id, emergency: emergency._id })));
    }
  }
}

async function start() {
  if (!process.env.MONGODB_URI || !process.env.JWT_SECRET || !process.env.PUBLIC_BASE_URL) {
    throw new Error('MONGODB_URI, JWT_SECRET, and PUBLIC_BASE_URL must be configured.');
  }
  const publicUrl = new URL(process.env.PUBLIC_BASE_URL);
  if (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.pathname !== '/') {
    throw new Error('PUBLIC_BASE_URL must be an HTTP(S) origin without a path.');
  }
  await mongoose.connect(process.env.MONGODB_URI);
  const port = Number(process.env.PORT || 10000);
  app.listen(port, '0.0.0.0', () => console.log(`Suraksha API listening on ${port}`));
  const timer = setInterval(() => processEscalations().catch((error) => console.error('Journey escalation job failed:', error)), 15000);
  if (timer.unref) timer.unref();
}

start().catch((error) => {
  console.error('Backend startup failed:', error);
  process.exit(1);
});
