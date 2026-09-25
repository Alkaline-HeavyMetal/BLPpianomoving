// Every 5 minutes: text the office when a truck is running 10+ minutes
// behind its first estimate, or has gone quiet for 8+ minutes mid-route.
// One alert per session per condition.
import { store, KEY } from './_lib.mjs';
import { drift } from './fleet.mjs';
const notify = (name, message) => fetch('https://blpsalesapp.netlify.app/.netlify/functions/request-notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: KEY, name, message, now: true }) }).catch(() => {});
export default async () => {
  const s = store();
  const names = (process.env.OFFICE_NAMES || 'Melissa').split(',').map(x => x.trim()).filter(Boolean);
  const { blobs } = await s.list({ prefix: 'track/' });
  let sent = 0;
  for (const b of blobs) {
    const r = await s.get(b.key, { type: 'json' });
    if (!r || r.status !== 'enroute' || Date.now() - new Date(r.startedAt) > 6 * 3600e3) continue;
    r.alerted = r.alerted || {};
    const d = drift(r);
    const quiet = r.lastLoc ? (Date.now() - new Date(r.lastLoc.at)) / 60000 : (Date.now() - new Date(r.startedAt)) / 60000;
    let msg = '';
    if (d >= 10 && !r.alerted.drift) { r.alerted.drift = new Date().toISOString(); msg = `⏱ ${r.crew || r.mover} is running ${d} min behind the ETA texted to ${r.customer} (${r.destination}). Consider texting the customer an update.`; }
    else if (quiet >= 8 && !r.alerted.quiet) { r.alerted.quiet = new Date().toISOString(); msg = `📵 No location from ${r.crew || r.mover}'s phone for ${Math.round(quiet)} min on the ${r.customer} move. The customer's tracking link has stopped moving — check in with the crew.`; }
    if (msg) { for (const n of names) await notify(n, msg); await s.setJSON(b.key, r); sent++; }
  }
  return new Response(JSON.stringify({ ok: true, sent }), { headers: { 'content-type': 'application/json' } });
};
export const config = { schedule: '*/5 * * * *' };
