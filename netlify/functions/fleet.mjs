// /api/fleet?key= — every live-ETA session from the last 12 hours, for the
// office map: truck position, ETA, drift against the first estimate, and
// how long since the phone last reported.
import { json, keyOk, store } from './_lib.mjs';
export function drift(rec) {
  if (!rec.etaMin || !rec.etaFirst) return 0;
  const first = new Date(rec.etaFirstAt || rec.startedAt).getTime() + rec.etaFirst * 60000;
  const nowEta = (rec.lastLoc ? new Date(rec.lastLoc.at).getTime() : Date.now()) + rec.etaMin * 60000;
  return Math.round((nowEta - first) / 60000);
}
export default async (req) => {
  if (!keyOk(null, req.url)) return json({ error: 'unauthorized' }, { status: 401 });
  const s = store();
  const { blobs } = await s.list({ prefix: 'track/' });
  const cutoff = Date.now() - 12 * 3600e3;
  const out = [];
  for (const b of blobs) {
    const r = await s.get(b.key, { type: 'json' });
    if (!r || new Date(r.startedAt).getTime() < cutoff) continue;
    const quietMin = r.lastLoc ? Math.round((Date.now() - new Date(r.lastLoc.at)) / 60000) : Math.round((Date.now() - new Date(r.startedAt)) / 60000);
    out.push({ token: r.token, customer: r.customer, destination: r.destination, destLoc: r.destLoc || null, crew: r.crew, mover: r.mover, piano: r.piano, status: r.status,
      startedAt: r.startedAt, endedAt: r.endedAt, lastLoc: r.lastLoc, etaMin: r.etaMin ?? null, etaFirst: r.etaFirst ?? null, drift: drift(r), quietMin, path: (r.path || []).slice(-40), alerted: r.alerted || null });
  }
  out.sort((a, b) => (a.status === 'enroute' ? 0 : 1) - (b.status === 'enroute' ? 0 : 1) || String(b.startedAt).localeCompare(String(a.startedAt)));
  return json({ ok: true, trucks: out, at: new Date().toISOString() });
};
