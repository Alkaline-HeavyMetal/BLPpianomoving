// /api/schedule — a mover's weekly availability + time off.
//   GET  ?key=&who=            -> {ok, schedule}
//   POST {key, who, schedule, summary} -> saves it and alerts the office:
//        texts OFFICE_NAMES through the Sales App's request-notify (by first
//        name) and emails info@ through the Movers bridge when configured.
import { json, readJson, keyOk, store, CORS, KEY } from './_lib.mjs';

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const s = store();
  if (req.method === 'GET') {
    if (!keyOk(null, req.url)) return json({ error: 'unauthorized' }, { status: 401 });
    const who = new URL(req.url).searchParams.get('who') || '';
    const rec = await s.get('schedule/' + who.toLowerCase(), { type: 'json' });
    return json({ ok: true, schedule: rec ? rec.schedule : null, updatedAt: rec ? rec.updatedAt : null });
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405 });
  const b = await readJson(req);
  if (!keyOk(b)) return json({ error: 'unauthorized' }, { status: 401 });
  if (!b.who || !b.schedule) return json({ error: 'who and schedule required' }, { status: 400 });
  const prev = await s.get('schedule/' + b.who.toLowerCase(), { type: 'json' });
  const rec = { who: b.who, schedule: b.schedule, summary: b.summary || '', updatedAt: new Date().toISOString(), history: [...((prev && prev.history) || []).slice(-20), { at: new Date().toISOString(), summary: b.summary || '' }] };
  await s.setJSON('schedule/' + b.who.toLowerCase(), rec);
  const msg = `📅 Schedule change — ${b.who}: ${(b.summary || '').slice(0, 600)}`;
  const names = (process.env.OFFICE_NAMES || 'Melissa').split(',').map(x => x.trim()).filter(Boolean);
  const texted = [];
  for (const name of names) {
    try {
      await fetch('https://blpsalesapp.netlify.app/.netlify/functions/request-notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: KEY, name, message: msg.slice(0, 1200), now: true }) });
      texted.push(name);
    } catch (e) {}
  }
  let emailed = false;
  if (process.env.MOVERS_BRIDGE_URL) {
    try {
      await fetch(process.env.MOVERS_BRIDGE_URL, { method: 'POST', redirect: 'follow', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ key: KEY, action: 'schedule', who: b.who, schedule: b.schedule, summary: b.summary }) });
      emailed = true;
    } catch (e) {}
  }
  return json({ ok: true, texted, emailed });
};
