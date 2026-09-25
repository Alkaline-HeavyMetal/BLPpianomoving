// GET /api/track?t=<token> — what the customer's tracking page polls. Public
// by design (the token is the secret); it never returns the phone number.
import { json, store, haversineMi } from './_lib.mjs';

export default async (req) => {
  const t = new URL(req.url).searchParams.get('t') || '';
  if (!/^[a-z0-9]{6,20}$/.test(t)) return json({ error: 'bad token' }, { status: 400 });
  const rec = await store().get('track/' + t, { type: 'json' });
  if (!rec) return json({ error: 'not found' }, { status: 404 });
  // sessions go stale after 4 hours without a location update
  const lastAt = rec.lastLoc ? new Date(rec.lastLoc.at) : new Date(rec.startedAt);
  const stale = Date.now() - lastAt > 4 * 3600e3;
  return json({
    ok: true, customer: rec.customer, destination: rec.destination, crew: rec.crew,
    piano: rec.piano, status: stale && rec.status === 'enroute' ? 'ended' : rec.status,
    startedAt: rec.startedAt, endedAt: rec.endedAt, lastLoc: rec.lastLoc,
    etaMin: rec.etaMin ?? null, distMi: rec.destLoc && rec.lastLoc ? haversineMi(rec.lastLoc, rec.destLoc) : null,
    path: (rec.path || []).slice(-60),
  });
};
