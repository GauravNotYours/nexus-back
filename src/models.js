const mongoose = require('mongoose');

const coordinatesSchema = new mongoose.Schema({
  lat: { type: Number, required: true, min: -90, max: 90 },
  lng: { type: Number, required: true, min: -180, max: 180 },
  accuracyMeters: { type: Number, min: 0 },
}, { _id: false });

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true, trim: true },
  phoneNormalized: { type: String, index: true, sparse: true },
  passwordHash: { type: String, required: true, select: false },
  emergencyPinHash: { type: String, required: true, select: false },
  pushTokens: [{
    token: { type: String, required: true },
    platform: { type: String, enum: ['android', 'ios'], required: true },
    updatedAt: { type: Date, default: Date.now },
  }],
  bloodType: { type: String, default: '' },
  medicalNotes: { type: String, default: '', maxlength: 1000 },
}, { timestamps: true });

const contactSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  phone: { type: String, required: true, trim: true },
  relationship: { type: String, default: 'Other', trim: true, maxlength: 40 },
  isPrimary: { type: Boolean, default: false },
  notifyOnMissedCheckIn: { type: Boolean, default: true },
  notifyOnSOS: { type: Boolean, default: true },
}, { timestamps: true });

const serviceSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['POLICE', 'HOSPITAL', 'FIRE', 'HELPLINE', 'CAMPUS_SECURITY'], required: true },
  phone: { type: String, required: true, trim: true },
  address: { type: String, required: true, trim: true },
  details: { type: String, default: '' },
  isOpen24x7: { type: Boolean, default: true },
  location: { type: coordinatesSchema, required: true },
}, { timestamps: true });

const riskZoneSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  center: { type: coordinatesSchema, required: true },
  radiusMeters: { type: Number, required: true, min: 50 },
  level: { type: String, enum: ['LOW', 'MODERATE', 'HIGH'], required: true },
  description: { type: String, required: true },
  active: { type: Boolean, default: true },
  validUntil: { type: Date },
}, { timestamps: true });

const notificationSchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  contact: { type: mongoose.Schema.Types.ObjectId, ref: 'TrustedContact' },
  emergency: { type: mongoose.Schema.Types.ObjectId, ref: 'Emergency' },
  journey: { type: mongoose.Schema.Types.ObjectId, ref: 'Journey' },
  channel: { type: String, enum: ['SMS', 'PUSH', 'IN_APP'], required: true },
  status: { type: String, enum: ['QUEUED', 'SENT', 'DELIVERED', 'FAILED'], required: true },
  message: { type: String, required: true, maxlength: 1600 },
  providerId: String,
  providerStatus: String,
  providerErrorCode: String,
  error: String,
}, { timestamps: true });

const emergencySchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  status: { type: String, enum: ['ACTIVE', 'CANCELLED', 'RESOLVED'], default: 'ACTIVE', index: true },
  coordinates: { type: coordinatesSchema },
  activatedAt: { type: Date, default: Date.now },
  resolvedAt: Date,
  source: { type: String, enum: ['SOS', 'MISSED_CHECK_IN', 'VOICE'], default: 'SOS' },
  journey: { type: mongoose.Schema.Types.ObjectId, ref: 'Journey' },
  shareToken: { type: String, unique: true, sparse: true, select: false },
  shareExpiresAt: Date,
}, { timestamps: true });

const journeySchema = new mongoose.Schema({
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  origin: { type: String, required: true, trim: true, maxlength: 160 },
  destination: { type: String, required: true, trim: true, maxlength: 160 },
  routeName: { type: String, default: '' },
  estimatedMinutes: { type: Number, required: true, min: 1, max: 1440 },
  checkInIntervalMinutes: { type: Number, required: true, min: 1, max: 1440 },
  trustedContact: { type: mongoose.Schema.Types.ObjectId, ref: 'TrustedContact', required: true },
  status: { type: String, enum: ['ACTIVE', 'MISSED_CHECKIN', 'ESCALATED', 'COMPLETED', 'CANCELLED'], default: 'ACTIVE', index: true },
  escalationLevel: { type: Number, default: 0, min: 0, max: 3 },
  startedAt: { type: Date, default: Date.now },
  expectedArrivalAt: { type: Date, required: true },
  nextCheckInAt: { type: Date, required: true, index: true },
  escalationAt: Date,
  lastCheckInAt: Date,
  checkInsCompleted: { type: Number, default: 0 },
  currentLocation: coordinatesSchema,
  completedAt: Date,
}, { timestamps: true });

module.exports = {
  User: mongoose.model('User', userSchema),
  TrustedContact: mongoose.model('TrustedContact', contactSchema),
  EmergencyService: mongoose.model('EmergencyService', serviceSchema),
  RiskZone: mongoose.model('RiskZone', riskZoneSchema),
  Notification: mongoose.model('Notification', notificationSchema),
  Emergency: mongoose.model('Emergency', emergencySchema),
  Journey: mongoose.model('Journey', journeySchema),
};
