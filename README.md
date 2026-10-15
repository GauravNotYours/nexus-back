# Suraksha Node.js API

Node.js/Express API backed by MongoDB. The API is the source of truth for accounts, trusted contacts, services, risk zones, emergencies, journey state, and notification delivery records.

## Run locally

1. Install Node.js 20 or newer and create a MongoDB database (MongoDB Atlas free tier works).
2. In `back`, run `npm install`.
3. Copy `.env.example` to `.env`; set `MONGODB_URI` and a long random `JWT_SECRET`.
4. Run `npm run seed` once to add example emergency-service and risk-zone records. Review and replace those records with verified local information before relying on them.
5. Run `npm run dev`. Health check: `http://localhost:10000/api/health`.

SMS is optional. To actually send SMS, set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER`; without them the API records notifications as `QUEUED` and explicitly reports that delivery is not configured. Missed check-ins are processed by a backend job every 15 seconds: first the configured trusted contact is notified, then an emergency record is created after the grace period if the user still has not checked in.

## Deploy on Render

Create a **Web Service** for this folder. Set the root directory to `back`, build command to `npm install`, and start command to `npm start`. Configure `MONGODB_URI`, `JWT_SECRET`, `PUBLIC_BASE_URL` (the service's HTTPS URL), and optional Twilio credentials in Render's environment settings. After deployment, set `EXPO_PUBLIC_API_URL` in the mobile build to the Render service URL (no trailing slash).

The service directory contains sample records derived from the provided design sample; locations and contacts are not independently verified. Do not present them as authoritative emergency-service information without validating them.
