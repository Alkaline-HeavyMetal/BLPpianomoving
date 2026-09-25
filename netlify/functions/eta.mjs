// POST /api/eta — start a live-ETA session for one move and text the
// customer the tracking link (Uber-style). Body:
//   {key, moveId, customer, phone, destination, crew, message?, mover}
// Returns {ok, token, url, sms:{sent, reason?}}
import { json, readJson, keyOk, store, token, e164, sendSms, CORS } from './_lib.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405 });
  const b = await readJson(req);
  if (!keyOk(b)) return json({ error: 'unauthorized' }, { status: 401 });
  if (!b.destination) return json({ error: 'destination required' }, { status: 400 });
  const t = token(10);
  const site = (process.env.URL || new URL(req.url).origin).replace(/\/$/, '');
  const url = `${site}/t/${t}`;
  const rec = {
    token: t, moveId: String(b.moveId || ''), customer: String(b.customer || 'there').slice(0, 60),
    phone: e164(b.phone) || '', destination: String(b.destination).slice(0, 200),
    crew: String(b.crew || '').slice(0, 80), mover: String(b.mover || '').slice(0, 40),
    piano: String(b.piano || '').slice(0, 80),
    startedAt: new Date().toISOString(), endedAt: null, status: 'enroute',
    lastLoc: null, path: [],
  };
  // optional: geocode so /api/location can estimate the ETA without a browser key
  const gk = process.env.GOOGLE_MAPS_SERVER_KEY;
  if (gk) {
    try {
      const g = await (await fetch('https://maps.googleapis.com/maps/api/geocode/json?address=' + encodeURIComponent(rec.destination) + '&key=' + gk)).json();
      const loc = g.results && g.results[0] && g.results[0].geometry.location;
      if (loc) rec.destLoc = { lat: loc.lat, lng: loc.lng };
    } catch (e) { /* tracking still works from the browser key */ }
  }
  const s = store();
  await s.setJSON('track/' + t, rec);
  let sms = { sent: false, reason: 'no phone' };
  const first = rec.customer.split(/\s+/)[0];
  const body = (b.message || `Hi ${first}, your Brigham Larson Pianos movers are on the way. Watch the truck and your live arrival time here: ${url}`)
    .replace('{url}', url).slice(0, 480);
  if (rec.phone) sms = await sendSms(rec.phone, body);
  await s.setJSON('track/' + t, { ...rec, sms: { ...sms, body, at: new Date().toISOString() } });
  return json({ ok: true, token: t, url, sms, body });
};
