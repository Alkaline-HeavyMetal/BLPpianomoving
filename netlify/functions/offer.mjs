// /api/offer — a mover offers a care item or product to a customer.
//   POST {key, mode:'text'|'sold'|'note', mover, move:{id,customer,phone,piano,type,date}, service:{id,name,kind,price,bonus}, text, amount, qty, payment, note}
//     1. mode 'text': texts the customer the marketing message (Twilio)
//     2. opens a lead in the BLP Sales App with the mover as Source of
//        Business (dedupes onto an existing lead by phone → timeline note);
//        on-site sales open it as "Won — sold on site"
//     3. keeps a durable copy for the mover's bonus tally
//   GET ?key=&who=<mover>  -> {ok, earned, pending, open, rows}
import { json, readJson, keyOk, store, token, e164, sendSms, CORS, KEY } from './_lib.mjs';

const SALES = (process.env.SALESAPP_URL || 'https://blpsalesapp.netlify.app').replace(/\/$/, '');

async function salesLead(o) {
  // team-passcode session, same as signing in to the Sales App
  const auth = await fetch(SALES + '/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ passcode: process.env.SALESAPP_PASSCODE || KEY }) });
  const cookie = (auth.headers.get('set-cookie') || '').split(';')[0];
  if (!auth.ok || !cookie) return { leadId: '', leadStatus: 'unreachable', error: 'sales app sign-in failed' };
  const H = { 'content-type': 'application/json', cookie };
  const [firstName, ...rest] = String(o.move.customer || 'Customer').trim().split(/\s+/);
  const sold = o.mode === 'sold';
  const headline = `${sold ? 'SOLD on site' : 'Movers offer'}: ${o.service.name}${sold && o.amount ? ' · $' + o.amount : ''}`;
  const notes = [
    `${sold ? 'Sold on site' : o.mode === 'text' ? 'Offer texted' : 'Interest noted'} by mover ${o.mover} during the ${o.move.date || ''} move${o.move.piano ? ' of ' + o.move.piano : ''}.`,
    sold ? `Collected $${o.amount} (${o.qty || 1} × ${o.service.name}) by ${o.payment || 'card'}.` : '',
    o.note ? 'Mover note: ' + o.note : '',
    o.mode === 'text' ? 'Text sent: "' + (o.text || '').slice(0, 300) + '"' : '',
    `Mover bonus when closed: $${o.service.bonus} (placeholder amount).`,
  ].filter(Boolean).join('\n');
  const r = await fetch(SALES + '/api/leads', { method: 'POST', headers: H, body: JSON.stringify({
    firstName, lastName: rest.join(' '), phone: o.move.phone || '', headline, notes,
    source: `Mover offer — ${o.mover}`, inquiryMethod: 'Movers app', leadType: o.service.kind === 'product' ? 'Product' : 'Service',
    pianoType: o.move.type || '', value: String(sold ? o.amount || '' : o.service.price || ''), capturedBy: o.mover,
    status: sold ? `Won — sold on site by ${o.mover}` : 'Active',
  }) });
  const j = await r.json().catch(() => ({}));
  if (r.ok && j.id) return { leadId: j.id, leadStatus: 'new' };
  // duplicate by phone → add a note to the existing lead instead
  const dup = /\((blp-[0-9a-f]+)\)/.exec(j.error || '');
  if (dup) {
    await fetch(`${SALES}/api/leads/${dup[1]}/timeline`, { method: 'POST', headers: H, body: JSON.stringify({ kind: 'note', who: o.mover, text: headline + '\n' + notes }) }).catch(() => {});
    return { leadId: dup[1], leadStatus: 'existing' };
  }
  return { leadId: '', leadStatus: 'failed', error: j.error || ('sales app ' + r.status) };
}

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const s = store();
  if (req.method === 'GET') {
    if (!keyOk(null, req.url)) return json({ error: 'unauthorized' }, { status: 401 });
    const who = (new URL(req.url).searchParams.get('who') || '').toLowerCase();
    const { blobs } = await s.list({ prefix: 'offer/' });
    const rows = [];
    for (const b of blobs.map(x => x.key).sort().reverse().slice(0, 300)) {
      const r = await s.get(b, { type: 'json' });
      if (r && (!who || String(r.mover || '').toLowerCase() === who)) rows.push(r);
    }
    const earned = rows.filter(r => r.status === 'won').reduce((a, r) => a + (+r.bonus || 0), 0);
    const open = rows.filter(r => r.status === 'open');
    return json({ ok: true, earned, pending: open.reduce((a, r) => a + (+r.bonus || 0), 0), open: open.length, rows: rows.slice(0, 50) });
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, { status: 405 });
  const b = await readJson(req);
  if (!keyOk(b)) return json({ error: 'unauthorized' }, { status: 401 });
  if (!b.service || !b.move) return json({ error: 'service and move required' }, { status: 400 });
  // office can flip an offer to won/lost by id: {key, close: id, status:'won'|'lost'}
  if (b.close) {
    const r = await s.get('offer/' + b.close, { type: 'json' });
    if (!r) return json({ error: 'not found' }, { status: 404 });
    r.status = b.status === 'won' ? 'won' : 'lost'; r.closedAt = new Date().toISOString();
    await s.setJSON('offer/' + b.close, r);
    return json({ ok: true });
  }
  const phone = e164(b.move.phone);
  let sms = { sent: false, reason: b.mode === 'text' ? (phone ? 'twilio not configured' : 'no phone') : 'not a text' };
  if (b.mode === 'text' && phone && b.text) sms = await sendSms(phone, String(b.text).slice(0, 480), b.service.image || '');
  let lead = { leadId: '', leadStatus: 'skipped' };
  try { lead = await salesLead(b); } catch (e) { lead = { leadId: '', leadStatus: 'failed', error: String(e) }; }
  const id = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14) + '-' + token(5);
  const rec = { id, at: new Date().toISOString(), mover: b.mover, mode: b.mode, customer: b.move.customer, phone: b.move.phone || '', piano: b.move.piano || '', moveId: b.move.id,
    service: b.service.name, serviceId: b.service.id, kind: b.service.kind, amount: +b.amount || 0, qty: +b.qty || 1, payment: b.payment || '', note: b.note || '',
    bonus: +b.service.bonus || 0, status: b.mode === 'sold' ? 'won' : 'open', sms, ...lead };
  await s.setJSON('offer/' + id, rec);
  return json({ ok: true, id, sms, ...lead });
};
