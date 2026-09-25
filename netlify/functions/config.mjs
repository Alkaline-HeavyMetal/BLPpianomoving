// GET /api/config — public runtime config for the pages (the Maps browser
// key is referrer-restricted in Google Cloud, so it is safe to hand out).
import { json } from './_lib.mjs';
export default async () => json({
  mapsKey: process.env.GOOGLE_MAPS_BROWSER_KEY || '',
  smsConfigured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
  site: process.env.URL || '',
});
