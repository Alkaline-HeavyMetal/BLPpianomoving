// /api/pianolog?serials=A,B,C — make / model / year / type for the pianos on
// today's moves, straight from the Piano Log via the Store Map's /api/data
// (public CSV export parsed there). Cached 5 minutes.
import { json } from './_lib.mjs';
const SRC = (process.env.STOREMAP_URL || 'https://blpstoremap.netlify.app') + '/api/data';
let cache = { at: 0, bySerial: null };
export function slim(p) {
  return { serial: p.serial, year: p.year || '', make: p.make || '', model: p.model || '', size: p.size || '', type: p.type || '', summary: p.summary || '', location: p.location || '', status: p.status || '', phase: p.phase || '', bench: p.bench || '', benchNote: p.benchNote || '', folder: p.mainFolder || '', importantNote: p.importantNote || '' };
}
export default async (req) => {
  const want = (new URL(req.url).searchParams.get('serials') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  if (!cache.bySerial || Date.now() - cache.at > 300000) {
    try {
      const d = await (await fetch(SRC)).json();
      const m = {};
      for (const p of d.pianos || []) if (p.serial) m[String(p.serial).trim().toUpperCase()] = slim(p);
      cache = { at: Date.now(), bySerial: m };
    } catch (e) { if (!cache.bySerial) return json({ error: 'piano log unreachable: ' + e }, { status: 502 }); }
  }
  const out = {};
  for (const s of want) if (cache.bySerial[s]) out[s] = cache.bySerial[s];
  return json({ ok: true, found: out, at: cache.at });
};
