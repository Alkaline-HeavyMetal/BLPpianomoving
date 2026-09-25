// POST /api/location — the mover's phone posts its position every few
// seconds while a live-ETA session is open. Body: {key, token, lat, lng,
// speed?, heading?, status?: 'enroute'|'arrived'|'ended', etaMin?}
import { json, readJson, keyOk, store, CORS, haversineMi } from './_lib.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405 });
  const b = await readJson(req);
  if (!keyOk(b)) return json({ error: 'unauthorized' }, { status: 401 });
  if (!b.token) return json({ error: 'token required' }, { status: 400 });
  const s = store();
  const rec = await s.get('track/' + b.token, { type: 'json' });
  if (!rec) return json({ error: 'unknown session' }, { status: 404 });
  const now = new Date().toISOString();
  if (Number.isFinite(+b.lat) && Number.isFinite(+b.lng)) {
    rec.lastLoc = { lat: +b.lat, lng: +b.lng, speed: +b.speed || 0, heading: +b.heading || 0, at: now };
    rec.path = [...(rec.path || []).slice(-400), { lat: +b.lat, lng: +b.lng, at: now }];
  }
  if (Number.isFinite(+b.etaMin)) rec.etaMin = Math.max(0, Math.round(+b.etaMin));
  else if (rec.destLoc && rec.lastLoc) {
    // rough fallback: straight-line miles at ~28 mph average, minimum 1 minute
    const mi = haversineMi(rec.lastLoc, rec.destLoc);
    rec.etaMin = Math.max(1, Math.round(mi / 28 * 60));
    if (mi < 0.08 && rec.status === 'enroute') rec.status = 'arrived';
  }
  if (b.status && ['enroute', 'arrived', 'ended'].includes(b.status)) {
    rec.status = b.status;
    if (b.status !== 'enroute') rec.endedAt = now;
  }
  await s.setJSON('track/' + b.token, rec);
  return json({ ok: true, status: rec.status });
};
