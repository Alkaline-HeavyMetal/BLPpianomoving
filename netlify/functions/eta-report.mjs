// POST /api/eta-report {token, etaMin} — the customer's tracking page
// reports the ETA it computed with Google Directions, so the office view can
// watch drift without its own Maps key. The token is the only credential.
import { json, readJson, store, CORS } from './_lib.mjs';
export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const b = await readJson(req);
  if (!/^[a-z0-9]{6,20}$/.test(b.token || '') || !Number.isFinite(+b.etaMin)) return json({ error: 'token and etaMin required' }, { status: 400 });
  const s = store();
  const r = await s.get('track/' + b.token, { type: 'json' });
  if (!r) return json({ error: 'not found' }, { status: 404 });
  r.etaMin = Math.max(0, Math.round(+b.etaMin));
  if (r.etaFirst == null) { r.etaFirst = r.etaMin; r.etaFirstAt = new Date().toISOString(); }
  await s.setJSON('track/' + b.token, r);
  return json({ ok: true });
};
