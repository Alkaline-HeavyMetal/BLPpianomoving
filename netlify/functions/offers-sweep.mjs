// Scheduled every 15 minutes: watches the BLP Sales App for mover leads
// that a sales rep marked WON (or lost). A win turns the row green on the
// mover's dashboard, recomputes the bonus from the lead's real $ Value, and
// texts the mover a celebration through request-notify (by first name).
import { store, KEY } from './_lib.mjs';

const SALES = (process.env.SALESAPP_URL || 'https://blpsalesapp.netlify.app').replace(/\/$/, '');
const TIERS = { product: 0.10, tiers: [[300, 0.08], [2000, 0.05], [10000, 0.04], [Infinity, 0.03]], min: 5, cap: 500 };
const bonusFor = (cost, kind) => { cost = +cost || 0; if (!cost) return 0; const pct = kind === 'product' ? TIERS.product : (TIERS.tiers.find(([l]) => cost < l) || [0, 0.03])[1]; return Math.min(TIERS.cap, Math.max(TIERS.min, Math.round(cost * pct))); };

export default async () => {
  const s = store();
  const auth = await fetch(SALES + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: process.env.SALESAPP_PASSCODE || KEY }) });
  const cookie = (auth.headers.get('set-cookie') || '').split(';')[0];
  if (!auth.ok || !cookie) return new Response('sales app sign-in failed', { status: 502 });
  const { blobs } = await s.list({ prefix: 'offer/' });
  let checked = 0, won = 0;
  for (const b of blobs) {
    const r = await s.get(b.key, { type: 'json' });
    if (!r || r.status !== 'open' || !r.leadId) continue;
    checked++;
    let lead = null;
    try { const j = await (await fetch(`${SALES}/api/leads/${r.leadId}`, { headers: { cookie } })).json(); lead = j.lead || j; } catch (e) { continue; }
    if (!lead || !lead.statusBucket) continue;
    if (lead.statusBucket === 'won') {
      const val = parseFloat(String(lead.value || '').replace(/[^0-9.]/g, ''));
      r.status = 'won'; r.wonAt = new Date().toISOString(); r.closedBy = lead.closedBy || lead.effectiveRep || '';
      if (val > 0) { r.ticket = val; r.bonus = bonusFor(val, r.kind); }
      await s.setJSON(b.key, r); won++;
      const first = String(r.mover || '').split(' ')[0];
      const msg = `🏆 WIN! ${first}, your ${r.service} offer to ${r.customer} just closed${r.ticket ? ' ($' + r.ticket + ')' : ''}. Your $${r.bonus} bonus is on the dashboard for your next paycheck. Keep offering!`;
      try { await fetch('https://blpsalesapp.netlify.app/.netlify/functions/request-notify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: KEY, name: first, message: msg, now: true }) }); } catch (e) {}
    } else if (lead.statusBucket === 'lost' || lead.statusBucket === 'unqualified') {
      r.status = 'lost'; r.closedAt = new Date().toISOString();
      await s.setJSON(b.key, r);
    }
  }
  return new Response(JSON.stringify({ ok: true, checked, won }), { headers: { 'content-type': 'application/json' } });
};
export const config = { schedule: '*/15 * * * *' };
