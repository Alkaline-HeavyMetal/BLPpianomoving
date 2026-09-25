// POST /api/log — durable copies of things the app files (condition-report
// metadata, change orders, upsell leads, clock stubs), so the app's "My
// reports" list works even before the Google bridge is set up.
//   POST {key, kind:'report'|'change'|'upsell'|'clock', data}
//   GET  ?key=&kind=&who=      -> newest 100 of that kind (optionally by who)
import { json, readJson, keyOk, store, token, CORS } from './_lib.mjs';

const KINDS = ['report', 'change', 'upsell', 'clock', 'clockfix'];
export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const s = store();
  if (req.method === 'GET') {
    const u = new URL(req.url);
    if (!keyOk(null, req.url)) return json({ error: 'unauthorized' }, { status: 401 });
    const kind = u.searchParams.get('kind') || 'report';
    const who = (u.searchParams.get('who') || '').toLowerCase();
    if (!KINDS.includes(kind)) return json({ error: 'bad kind' }, { status: 400 });
    const { blobs } = await s.list({ prefix: kind + '/' });
    const keys = blobs.map(b => b.key).sort().reverse().slice(0, 100);
    const rows = [];
    for (const k of keys) {
      const r = await s.get(k, { type: 'json' });
      if (r && (!who || String(r.who || '').toLowerCase() === who)) rows.push(r);
    }
    return json({ ok: true, rows });
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405 });
  const b = await readJson(req);
  if (!keyOk(b)) return json({ error: 'unauthorized' }, { status: 401 });
  if (!KINDS.includes(b.kind)) return json({ error: 'bad kind' }, { status: 400 });
  const id = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + token(5);
  const rec = { id, kind: b.kind, at: new Date().toISOString(), who: String(b.who || ''), ...(b.data || {}) };
  await s.setJSON(`${b.kind}/${id}`, rec);
  return json({ ok: true, id });
};
