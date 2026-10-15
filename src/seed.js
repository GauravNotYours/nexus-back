require('dotenv').config();
const mongoose = require('mongoose');
const { EmergencyService, RiskZone } = require('./models');

const services = [
  { name: 'UP 112 Unified Emergency Helpline', type: 'HELPLINE', phone: '112', address: 'Uttar Pradesh, India', details: 'Call 112 for state emergency response. Verify local availability before relying on this listing.', isOpen24x7: true, location: { lat: 26.8467, lng: 80.9462 } },
  { name: 'Women Power Line 1090', type: 'HELPLINE', phone: '1090', address: 'Lucknow, Uttar Pradesh', details: 'Women-focused helpline. Verify current service details locally.', isOpen24x7: true, location: { lat: 26.8467, lng: 80.9462 } },
  { name: 'Emergency Ambulance 108', type: 'HELPLINE', phone: '108', address: 'Lucknow, Uttar Pradesh', details: 'Ambulance helpline listing. Verify local service availability.', isOpen24x7: true, location: { lat: 26.8467, lng: 80.9462 } },
  { name: 'Sewa Hospital & Research Centre', type: 'HOSPITAL', phone: '+91 63890 00615', address: 'Sitapur Road, Lucknow, Uttar Pradesh', details: 'Seed listing from the supplied sample; confirm address, phone, and emergency hours before production.', isOpen24x7: true, location: { lat: 26.9124, lng: 80.9422 } },
  { name: 'Jankipuram Police Station', type: 'POLICE', phone: '112', address: 'Jankipuram, Lucknow, Uttar Pradesh', details: 'Approximate directory location; verify with local authorities.', isOpen24x7: true, location: { lat: 26.9120, lng: 80.9460 } },
];

async function seed() {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI must be configured.');
  await mongoose.connect(process.env.MONGODB_URI);
  for (const service of services) {
    await EmergencyService.updateOne({ name: service.name }, { $set: service }, { upsert: true });
  }
  await RiskZone.updateOne(
    { name: 'Sample safety zone - verify before use' },
    { $set: { name: 'Sample safety zone - verify before use', center: { lat: 26.9124, lng: 80.9422 }, radiusMeters: 600, level: 'MODERATE', description: 'Example risk zone from seed data. Replace with locally verified, maintained information.', active: true } },
    { upsert: true },
  );
  await mongoose.disconnect();
  console.log(`Seeded ${services.length} emergency services and an example risk zone.`);
}

seed().catch(async (error) => {
  console.error('Database seeding failed:', error);
  await mongoose.disconnect();
  process.exit(1);
});
