/* BLP Movers — Brigham Larson Pianos piano moving crew app.
 * Vanilla JS, no build step. Data comes from the pianomoving.blp Google
 * Calendar through apps-script/Movers.gs; live ETA + logs go through the
 * Netlify functions; 💡 suggestions go to the Store Map bridge so they show
 * up in Store Map → Admin → App Requests like every other BLP app. */
(() => {
const CFG = window.BLP_MOVERS_CONFIG || {};
const VERSION = '0.1.0';
const TZ = 'America/Denver';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ls = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
  json(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
};
const S = { day: today(), moves: [], loadedDay: '', demo: false, me: null, share: ls.json('blpShare'), cfg: {}, watchId: null, lastPost: 0, all: {}, range: {} };

/* ===================== dates ===================== */
function today() { return new Date().toLocaleDateString('en-CA', { timeZone: TZ }); }
function addDays(d, n) { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); }
function fmtDay(d) { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }
function fmtShort(d) { return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
function fmtTime(t) {
  if (!t) return '<span style="font-size:14px">all day</span>';
  const [h, m] = t.split(':').map(Number);
  const hh = ((h + 11) % 12) + 1;
  return `${hh}:${String(m).padStart(2, '0')}<sup style="font-size:10px;letter-spacing:.05em;margin-left:1px">${h < 12 ? 'AM' : 'PM'}</sup>`;
}
function nowHHMM() { return new Date().toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }); }

/* ===================== UI helpers ===================== */
let toastT = null;
function toast(msg, err) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (err ? ' err' : ''); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, err ? 5000 : 2800);
}
function sheet(html) {
  const s = $('#sheet'), b = $('#sheetBox');
  b.innerHTML = '<div class="handle"></div><button type="button" class="sheetx" id="sheetX" aria-label="Close">✕</button>' + html; s.hidden = false;
  s.onclick = ev => { if (ev.target === s) closeSheet(); };
  $('#sheetX', b).onclick = closeSheet;
  return b;
}
function closeSheet() { $('#sheet').hidden = true; $('#sheetBox').innerHTML = ''; }
function openDrawer(o) { $('#drawer').classList.toggle('open', o); $('#scrim').classList.toggle('show', o); }
function stairsIcon() { return '<svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 20h4v-4h4v-4h4V8h4V4h2v6h-4v4h-4v4H9v4H3z"/></svg>'; }
function pinIcon() { return '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z"/></svg>'; }
function msgIcon() { return '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z"/></svg>'; }
const mapsUrl = addr => 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(addr) + '&travelmode=driving';
const telUrl = p => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
const smsUrl = (p, body) => 'sms:' + String(p || '').replace(/[^\d+]/g, '') + (/iphone|ipad|ipod/i.test(navigator.userAgent) ? '&' : '?') + 'body=' + encodeURIComponent(body);
async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch (e) { toast('Could not copy — long-press to select', true); }
}

/* ===================== auth: Google sign-in (BLP accounts) or the team password =====================
 * Same OAuth pattern as the Store Map: a plain redirect to Google asking
 * for an ID token, which comes back in the URL hash and is checked here
 * (nonce, audience, expiry, allowed email). The team password is the
 * fallback until Google sign-in is verified on every phone. */
function b64url(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return decodeURIComponent(escape(atob(s))); }
function rand() { return Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join(''); }
function oidcLogin() {
  if (!CFG.googleClientId) { setMsg('#gateMsg', 'Google sign-in is not configured yet — use the team password.', 'err'); return; }
  const nonce = rand(), state = rand();
  ls.set('blpNonce', nonce); ls.set('blpState', state);
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.search = new URLSearchParams({ client_id: CFG.googleClientId, redirect_uri: location.origin + '/', response_type: 'id_token', scope: 'openid email profile', nonce, state, prompt: 'select_account' }).toString();
  location.href = u.toString();
}
// Google answers on the site root with #id_token=…&state=… — consume it before hash routing sees it
function consumeOidcHash() {
  const h = location.hash.slice(1);
  if (!/(^|&)id_token=/.test(h)) return false;
  const q = new URLSearchParams(h);
  history.replaceState(null, '', location.pathname + '#today');
  const tok = q.get('id_token') || '';
  try {
    if (q.get('state') !== ls.get('blpState')) throw new Error('sign-in state mismatch — try again');
    const p = JSON.parse(b64url(tok.split('.')[1] || ''));
    if (p.nonce !== ls.get('blpNonce')) throw new Error('sign-in nonce mismatch — try again');
    if (p.aud !== CFG.googleClientId) throw new Error('token is for a different app');
    if (p.exp * 1000 < Date.now()) throw new Error('sign-in expired — try again');
    const email = String(p.email || '').toLowerCase();
    if (!p.email_verified || !CFG.allowedEmail.test(email)) throw new Error('That Google account is not a BLP team account (' + email + '). Use your brighamlarsonpianos.com login.');
    S.me = { name: p.name || email.split('@')[0], email, pic: p.picture || '', key: CFG.teamKey, google: true, tokExp: p.exp * 1000, since: new Date().toISOString() };
    ls.set('blpMover', JSON.stringify(S.me));
    ls.del('blpNonce'); ls.del('blpState');
    return true;
  } catch (e) {
    ls.set('blpAuthErr', e.message);
    return false;
  }
}
function loadMe() {
  S.me = ls.json('blpMover');
  const err = ls.get('blpAuthErr'); if (err) { ls.del('blpAuthErr'); $('#gate').hidden = false; setMsg('#gateMsg', '✗ ' + err, 'err'); return false; }
  if (!S.me || !S.me.name) { $('#gate').hidden = false; return false; }
  $('#drawerWho').textContent = S.me.name;
  $('#drawerRole').textContent = S.me.google ? S.me.email : 'team password';
  return true;
}
$('#gateGoogle').onclick = oidcLogin;
$('#gateGo').onclick = () => {
  const name = $('#gateName').value.trim(), key = $('#gatePin').value.trim();
  if (name.split(/\s+/).length < 2) { setMsg('#gateMsg', 'First and last name, please — reports carry it.', 'err'); return; }
  if (key !== CFG.teamKey) { setMsg('#gateMsg', 'That is not the team password.', 'err'); return; }
  S.me = { name, key, google: false, since: new Date().toISOString() };
  ls.set('blpMover', JSON.stringify(S.me));
  $('#gate').hidden = true; $('#drawerWho').textContent = name; $('#drawerRole').textContent = 'team password';
  loadMoves(S.day).then(route);
};
$('#signOut').onclick = () => { ls.del('blpMover'); location.hash = ''; location.reload(); };
const KEY = () => (S.me && S.me.key) || CFG.teamKey || '';

/* ===================== data: moves ===================== */
async function bridgeGet(url) {
  const r = await fetch(url, { redirect: 'follow', cache: 'no-store' });
  return r.json();
}
async function bridgePost(url, body, tries = 3) {
  let j = null;
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fetch(url, { method: 'POST', redirect: 'follow', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
      j = await r.json().catch(() => null);
    } catch (e) { j = null; }
    if (j && (j.ok || j.error)) return j;
    await new Promise(res => setTimeout(res, 900 * (a + 1)));
  }
  return j || { error: 'the Google bridge did not answer — try again in a few seconds' };
}
async function api(path, body) {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: KEY(), ...body }) } : { cache: 'no-store' });
  return r.json();
}
async function fetchEvents(from, to) {
  if (CFG.moversBridgeUrl) {
    const j = await bridgeGet(`${CFG.moversBridgeUrl}?fn=moves&from=${from}&to=${to}`);
    if (j.error) throw new Error(j.error);
    S.demo = false;
    return j.events || [];
  }
  const j = await (await fetch('data/demo-moves.json', { cache: 'no-store' })).json();
  S.demo = true;
  const t = today();
  return (j.events || []).map(e => ({ ...e, date: e.date === 'TODAY' ? t : e.date === 'TOMORROW' ? addDays(t, 1) : e.date }))
    .filter(e => e.date >= from && e.date <= to);
}
async function fetchRange(from, to) {
  const k = from + '|' + to, hit = S.range[k];
  if (hit && Date.now() - hit.at < 120000) return hit.moves;
  const moves = (await fetchEvents(from, to)).map(parseMove);
  moves.forEach(m => { S.all[m.id] = m; });
  S.range[k] = { at: Date.now(), moves };
  return moves;
}
async function loadMoves(day, quiet) {
  try {
    const evs = await fetchEvents(day, day);
    S.moves = evs.map(parseMove).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    S.moves.forEach(m => { S.all[m.id] = m; });
    S.loadedDay = day;
    ls.set('blpMoves:' + day, JSON.stringify(evs));
  } catch (e) {
    const cached = ls.json('blpMoves:' + day);
    if (cached) { S.moves = cached.map(parseMove); S.moves.forEach(m => { S.all[m.id] = m; }); S.loadedDay = day; if (!quiet) toast('Offline — showing the last loaded moves', true); }
    else { S.moves = []; S.loadedDay = day; if (!quiet) toast('Could not load moves: ' + e.message, true); }
  }
}

/* ---- calendar event → move. Tolerant of how the office writes events:
 * labeled lines ("Phone:", "Stairs:", "Bench:", "From:", "To:") win; free
 * text falls back to regexes ("14 stairs up", "no bench", a phone number). */
const MAKES = 'Yamaha|Kawai|Hailun|Steinway|Baldwin|Boston|Essex|Bösendorfer|Bosendorfer|Mason|Hamlin|Petrof|Schimmel|Kohler|Wurlitzer|Chickering|Knabe|Story|Clark|Samick|Young Chang|Pearl River|Ritmüller|Ritmuller|Hardman|Everett|Sohmer|Weber|Kimball|Roland|Casio|Clavinova|Kranich|Bach|Bechstein|Blüthner|Bluthner|Fazioli|Estonia|Charles Walter|Hallet|Davis|Cable|Nelson|Lester|Gulbransen|Krakauer|Steck|Aeolian';
function labeled(desc, keys) {
  for (const k of keys) {
    const m = new RegExp('^\\s*' + k + '\\s*[:\\-–]\\s*(.+)$', 'im').exec(desc);
    if (m) return m[1].trim();
  }
  return '';
}
function parseMove(ev) {
  const title = String(ev.title || '').replace(/\s+/g, ' ').trim();
  const desc = String(ev.description || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
  const loc = String(ev.location || '').trim();
  const all = title + '\n' + desc + '\n' + loc;
  const done = /^\s*x\s+/i.test(title);
  const clean = title.replace(/^\s*x\s+/i, '');
  // crew: "Tanner/Jace: ..." (Store Map convention)
  let crew = '', rest = clean;
  const cm = /^([A-Za-z .'&/+]{2,40}):\s*(.+)$/.exec(clean);
  if (cm && cm[1].split(/\s+/).length <= 4 && !/^(pickup|pick up|deliver|delivery|move|piano)/i.test(cm[1])) { crew = cm[1].trim(); rest = cm[2]; }
  const phone = labeled(desc, ['phone', 'cell', 'tel', 'mobile', 'customer phone']) || ((all.match(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/) || [])[0] || '').trim();
  let customer = labeled(desc, ['customer', 'client', 'name', 'buyer', 'seller']);
  if (!customer) {
    const m = /(?:for|to|from)\s+(?:the\s+)?([A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+)?)(?:'s|’s)?(?:\s+(?:house|home|place|residence))?/.exec(rest);
    if (m && !new RegExp('^(' + MAKES + '|BLP|Showroom|Store|Orem|Provo|Lehi)$', 'i').test(m[1])) customer = m[1];
  }
  if (!customer) customer = (rest.split(/[-–—,:]/)[0] || 'Customer').trim().slice(0, 40);
  customer = customer.replace(/'s$|’s$/, '');
  let piano = labeled(desc, ['piano', 'instrument', 'model']);
  if (!piano) {
    const mk = new RegExp('((?:' + MAKES + ')[^,\\n]{0,40})', 'i').exec(all);
    const ty = /(baby grand|grand|upright|console|spinet|studio|digital|vertical|player)/i.exec(all);
    piano = [mk && mk[1].trim(), (!mk || !new RegExp(ty ? ty[1] : '$^', 'i').test(mk[1])) && ty && ty[1]].filter(Boolean).join(' ');
  }
  const serial = ((all.match(/\b(?:SN|S\/N|serial)\s*#?\s*:?\s*([A-Z0-9-]{4,12})/i) || [])[1] || '');
  const type = /grand/i.test(piano + ' ' + all) ? 'Grand' : /digital|clavinova|roland|casio/i.test(piano + ' ' + all) ? 'Digital' : /upright|console|spinet|studio|vertical/i.test(piano + ' ' + all) ? 'Upright' : '';
  let from = labeled(desc, ['from', 'pickup', 'pick up', 'pick-up', 'origin', 'pickup address']);
  let to = labeled(desc, ['to', 'deliver', 'delivery', 'deliver to', 'destination', 'delivery address']);
  const isDelivery = /deliver/i.test(rest) && !/pick\s*up|pickup/i.test(rest);
  const isPickup = /pick\s*up|pickup/i.test(rest) && !/deliver/i.test(rest);
  if (loc && !to && !from) { if (isPickup) from = loc; else to = loc; }
  if (loc && !to && isDelivery) to = loc;
  if (loc && !from && isPickup) from = loc;
  const kind = from && to && !/blp|showroom|store|shop/i.test(from) && !/blp|showroom|store|shop/i.test(to) ? 'move'
    : /in[- ]store|in store|showroom move/i.test(all) ? 'in-store' : isPickup ? 'pickup' : isDelivery ? 'delivery' : from && to ? 'move' : 'move';
  const nav = (kind === 'pickup' ? from : to) || to || from || loc;
  // stairs
  const st = labeled(desc, ['stairs', 'steps', 'stair']) || ((all.match(/[^.\n]*\b(stairs?|steps?|flights?)\b[^.\n]*/i) || [])[0] || '').trim();
  const none = /\b(no|zero|0)\s+(stairs|steps)\b|ground floor|no flights?/i.test(st) || /\bno stairs\b/i.test(all);
  const cnt = +((st.match(/(\d{1,3})\s*(?:stairs|steps|stair)/i) || [])[1] || 0);
  const fl = (st.match(/(\d+|one|two|three|a|full)\s*(?:full\s+)?flights?/i) || [])[1];
  const flights = fl ? ({ one: 1, a: 1, full: 1, two: 2, three: 3 }[fl.toLowerCase()] || +fl || 1) : (cnt >= 10 ? Math.round(cnt / 13) || 1 : 0);
  const dir = /\bdown\b/i.test(st) ? 'down' : /\bup\b/i.test(st) ? 'up' : '';
  const stairs = { text: st, none, count: cnt, flights, dir, has: !none && (cnt > 0 || flights > 0 || /\bstairs\b/i.test(st)), warn: !none && (cnt >= 6 || flights > 0) };
  const bl = labeled(desc, ['bench']);
  const bench = bl ? (/^(no|none|n\b)/i.test(bl) ? 'no' : 'yes') : /\bno bench\b/i.test(all) ? 'no' : /\bbench\b/i.test(all) ? 'yes' : '';
  const benchNote = bl.replace(/^(yes|no|none)\s*[-–(]?\s*/i, '').replace(/\)$/, '').trim();
  const gate = ((all.match(/gate(?: code)?\s*[:#]?\s*(\d{3,8})/i) || [])[1] || '');
  const price = ((all.match(/\$\s?\d[\d,]*(?:\.\d\d)?/) || [])[0] || '');
  const balance = ((desc.match(/(?:collect|balance|due|owe)[^$\n]*(\$\s?\d[\d,]*(?:\.\d\d)?)/i) || [])[1] || '');
  return { id: ev.id || (ev.date + '-' + (ev.time || '') + '-' + customer), eventId: ev.id || '', date: ev.date, time: ev.time, end: ev.end, title, rest, description: desc, location: loc,
    done, crew, customer, phone, piano: piano || type || 'Piano', serial, type, from, to, kind, nav, stairs, bench, benchNote, gate, price, balance, color: ev.color || '' };
}
function stairsLabel(m) {
  const s = m.stairs;
  if (s.none) return '';
  if (!s.has) return '';
  const parts = [];
  if (s.count) parts.push(s.count + ' stairs');
  if (s.flights) parts.push(s.flights === 1 ? '1 flight' : s.flights + ' flights');
  if (!parts.length) parts.push('stairs');
  return parts.join(' · ') + (s.dir ? ' ' + s.dir : '');
}

/* ===================== routing ===================== */
window.addEventListener('hashchange', route);
async function route() {
  if (!S.me) return;
  openDrawer(false); closeSheet();
  const [view, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const v = view || 'today';
  $$('#tabs a').forEach(a => a.classList.toggle('on', a.dataset.tab === v || ((v === 'week' || v === 'month') && a.dataset.tab === 'today')));
  const main = $('#main');
  window.scrollTo(0, 0);
  const need = { today: 1, details: 1, report: 1, change: 1, offer: 1 }[v];
  const id = arg ? decodeURIComponent(arg) : '';
  let m = id ? S.all[id] : null;
  if (v === 'today' && S.loadedDay !== S.day) { main.innerHTML = '<div class="empty">Loading moves…</div>'; await loadMoves(S.day, true); }
  if (need && v !== 'today' && id && !m) { await loadMoves(S.day, true); m = S.all[id]; }
  if (need && v !== 'today' && !m) { location.hash = '#today'; return; }
  switch (v) {
    case 'today': return renderToday();
    case 'week': return renderWeek();
    case 'month': return renderMonth();
    case 'details': return renderDetails(m);
    case 'report': return renderReport(m);
    case 'change': return renderChange(m);
    case 'services': case 'upsell': return renderServices('', arg ? decodeURIComponent(arg) : '');
    case 'offer': return renderServices(m, '');
    case 'checklist': return renderChecklist();
    case 'history': return renderHistory();
    case 'clock': return renderClock();
    case 'more': return renderMore();
    default: location.hash = '#today';
  }
}

/* ===================== TODAY ===================== */
function renderToday() {
  const main = $('#main');
  const moves = S.moves, d = S.day;
  const flights = moves.filter(m => m.stairs.warn && !m.done).length;
  const crew = [...new Set(moves.map(m => m.crew).filter(Boolean))].join(' · ');
  const open = moves.filter(m => !m.done).length;
  const now = nowHHMM();
  let nextId = null;
  if (d === today()) { const nx = moves.find(m => !m.done && (!m.end || m.end >= now)); nextId = nx ? nx.id : null; }
  main.innerHTML = `
    <div class="dayhead">
      <div><h1>${d === today() ? 'Today, ' : ''}${esc(fmtDay(d))}</h1>
        <div class="sub">${moves.length ? `${moves.length} move${moves.length === 1 ? '' : 's'}${open !== moves.length ? ` · ${open} to go` : ''} · ${flights ? flights + ' with a flight of stairs' : 'no flights of stairs'}${crew ? ' · ' + esc(crew) : ''}` : 'Nothing on the moving calendar'}</div></div>
      <div class="daynav"><button id="dPrev" aria-label="Previous day"><span>‹</span></button><button id="dNext" aria-label="Next day"><span>›</span></button></div>
    </div>
    ${viewSwitch('day')}
    ${S.demo ? '<div class="demo"><b>Example day.</b> Connect the Movers bridge in config.js and this board fills from the pianomoving.blp calendar.</div>' : ''}
    <div class="moves">${moves.length ? moves.map(m => moveCard(m, m.id === nextId)).join('') : '<div class="empty">No moves scheduled. Enjoy the quiet, or check the week.</div>'}</div>
    ${moves.filter(m => !m.done).length > 1 ? `<div style="padding:16px 0"><a class="btn wide sm" target="_blank" rel="noopener" href="${routeDayUrl(moves)}">${pinIcon()} Route my whole day in Google Maps</a></div>` : ''}`;
  $('#dPrev').onclick = () => { S.day = addDays(S.day, -1); loadMoves(S.day).then(renderToday); };
  $('#dNext').onclick = () => { S.day = addDays(S.day, 1); loadMoves(S.day).then(renderToday); };
  $$('[data-eta]').forEach(b => b.onclick = () => etaSheet(S.moves.find(m => m.id === b.dataset.eta)));
}
function routeDayUrl(moves) {
  const stops = moves.filter(m => !m.done).map(m => m.nav).filter(Boolean);
  const last = stops.pop();
  return 'https://www.google.com/maps/dir/?api=1&origin=' + encodeURIComponent(CFG.homeBase || '') + '&destination=' + encodeURIComponent(last || '') + (stops.length ? '&waypoints=' + encodeURIComponent(stops.join('|')) : '') + '&travelmode=driving';
}
function moveCard(m, isNext) {
  const status = m.done ? 'Done' : isNext ? 'Next' : (S.day < today() ? 'Past' : S.day > today() ? 'Ahead' : (m.end && m.end < nowHHMM() ? 'Due' : (m.time && m.time <= nowHHMM() ? 'Now' : 'Later')));
  const live = S.share && S.share.moveId === m.id;
  const chips = [];
  const sl = stairsLabel(m);
  if (sl) chips.push(`<span class="chip warn">${stairsIcon()}${esc(sl)}</span>`);
  else if (m.stairs.none) chips.push('<span class="chip good">No stairs</span>');
  if (m.bench) chips.push(`<span class="chip">${m.bench === 'yes' ? 'Bench' : 'No bench'}${m.benchNote && m.bench === 'yes' ? ' · ' + esc(m.benchNote.slice(0, 18)) : ''}</span>`);
  if (m.gate) chips.push(`<span class="chip">Gate ${esc(m.gate)}</span>`);
  if (m.balance) chips.push(`<span class="chip warn" style="background:#3A3835;border-color:#3A3835">Collect ${esc(m.balance)}</span>`);
  if (m.kind === 'in-store') chips.push('<span class="chip soft">In-store</span>');
  const id = encodeURIComponent(m.id);
  return `<article class="move ${m.done ? 'done' : ''} ${live ? 'live' : ''}" id="mv-${esc(m.id)}">
    <div class="mtime">${fmtTime(m.time)}<small class="${isNext ? 'live' : ''}">${live ? 'Sharing' : status}</small></div>
    <div class="mbody">
      <div><div class="mname">${esc(m.customer)}</div><div class="mpiano">${esc(m.piano)}${m.serial && !m.piano.includes(m.serial) ? ' · SN ' + esc(m.serial) : ''}${m.kind === 'pickup' ? ' · pickup' : m.kind === 'delivery' ? ' · delivery' : ''}</div></div>
      ${m.from || m.to ? `<div class="addr">${m.from ? `<div class="a"><b>FROM</b><span>${esc(m.from)}</span></div>` : ''}${m.to ? `<div class="a"><b>TO</b><span>${esc(m.to)}</span></div>` : ''}</div>` : (m.location ? `<div class="addr"><div class="a"><b>AT</b><span>${esc(m.location)}</span></div></div>` : '')}
      ${chips.length ? `<div class="chips">${chips.join('')}</div>` : ''}
      ${m.done ? '' : `<div class="btns">
        <a class="btn nav" href="${m.nav ? mapsUrl(m.nav) : '#'}" target="_blank" rel="noopener">${pinIcon()} Navigate</a>
        <button class="btn eta" data-eta="${esc(m.id)}">${msgIcon()} Text ETA</button>
      </div>`}
      <div class="mlinks">
        <a href="#report/${id}">✎ Condition report</a>
        <a href="#change/${id}">$ Move differs</a>
        <a href="#offer/${id}">✦ Customer interested</a>
        <a href="#details/${id}" class="quiet">Details ›</a>
      </div>
    </div></article>`;
}

/* ===================== TEXT ETA + live location ===================== */
async function etaSheet(m) {
  if (!m) return;
  const first = m.customer.split(/\s+/)[0];
  const shop = CFG.shopName || 'Brigham Larson Pianos';
  const T = {
    late: `Hi ${first}, this is ${S.me.name.split(' ')[0]} with ${shop}. We're running about 15 minutes behind — sorry for the wait, we'll see you soon.`,
    arrived: `Hi ${first}, your ${shop} movers have arrived.`,
    done: `Hi ${first}, thank you from all of us at ${shop}! Your piano will need a tuning after it settles in about 2–4 weeks — text or call ${CFG.shopPhone} to schedule. If we did a great job today, a quick Google review means a lot: ${CFG.reviewUrl}`,
    plain: `Hi ${first}, your ${shop} movers are on the way to ${m.nav || 'you'} and should arrive around ${etaGuess(m)}.`,
  };
  const b = sheet(`<h3>Text ${esc(m.customer)}</h3>
    <label class="fld">Customer phone<input id="etaPhone" type="tel" value="${esc(m.phone)}" placeholder="801-555-0100"></label>
    <div class="opts">
      <button class="opt red" data-k="live"><b>${msgIcon()} Send the live tracking link</b><small>Uber-style: a link that shows our truck on a map and a live arrival time. Your phone shares its location until you tap Arrived.</small></button>
      <button class="opt" data-k="plain"><b>On our way (plain text)</b><small>${esc(T.plain)}</small></button>
      <button class="opt" data-k="late"><b>Running late</b><small>${esc(T.late)}</small></button>
      <button class="opt" data-k="arrived"><b>We've arrived</b><small>${esc(T.arrived)}</small></button>
      <button class="opt" data-k="done"><b>Delivered — thank you + review</b><small>${esc(T.done)}</small></button>
    </div>
    <div class="msg" id="etaMsg"></div>`);
  $$('.opt', b).forEach(o => o.onclick = async () => {
    const phone = $('#etaPhone', b).value.trim();
    const k = o.dataset.k;
    if (k !== 'live') { if (!phone) return setMsg('#etaMsg', 'Add a phone number first.', 'err'); location.href = smsUrl(phone, T[k]); return; }
    o.disabled = true; setMsg('#etaMsg', 'Starting live tracking…');
    try {
      const j = await api('/api/eta', { moveId: m.id, customer: m.customer, phone, destination: m.nav, crew: m.crew || S.me.name, mover: S.me.name, piano: m.piano });
      if (!j.ok) throw new Error(j.error || 'could not start');
      startSharing({ token: j.token, url: j.url, moveId: m.id, customer: m.customer, at: Date.now() });
      if (j.sms && j.sms.sent) { toast('Tracking link texted to ' + m.customer); closeSheet(); renderToday(); }
      else {
        // Twilio not set up (or no phone): hand the link to the phone's own Messages app
        const body = j.body || `Hi ${first}, your ${shop} movers are on the way. Watch the truck and your live arrival time here: ${j.url}`;
        setMsg('#etaMsg', 'Live tracking is on. ' + (phone ? 'Opening Messages with the link…' : 'No phone number — copy the link below.'), 'ok');
        if (phone) setTimeout(() => { location.href = smsUrl(phone, body); }, 400);
        b.insertAdjacentHTML('beforeend', `<div class="card"><div class="lite">Tracking link</div><div style="word-break:break-all;font-weight:600">${esc(j.url)}</div><div style="margin-top:8px"><button class="btn sm" id="cpLink">Copy link</button></div></div>`);
        $('#cpLink', b).onclick = () => copy(j.url);
        renderToday();
      }
    } catch (e) { setMsg('#etaMsg', '✗ ' + e.message, 'err'); o.disabled = false; }
  });
}
function etaGuess(m) {
  const t = new Date(Date.now() + 30 * 60000);
  return t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
}
function setMsg(sel, text, cls) { const e = $(sel); if (e) { e.textContent = text; e.className = 'msg ' + (cls || ''); } }
function startSharing(share) {
  S.share = share; ls.set('blpShare', JSON.stringify(share));
  $('#shareBar').hidden = false;
  $('#shareTxt').textContent = 'Sharing live ETA with ' + share.customer;
  if (S.watchId != null) navigator.geolocation.clearWatch(S.watchId);
  if (!navigator.geolocation) { toast('This phone is not sharing location', true); return; }
  S.watchId = navigator.geolocation.watchPosition(pos => {
    if (Date.now() - S.lastPost < 8000) return;
    S.lastPost = Date.now();
    api('/api/location', { token: share.token, lat: pos.coords.latitude, lng: pos.coords.longitude, speed: pos.coords.speed, heading: pos.coords.heading }).catch(() => {});
  }, err => { if (err.code === 1) toast('Allow location so the customer can see the truck', true); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  keepAwake();
}
async function keepAwake() { try { if (navigator.wakeLock) await navigator.wakeLock.request('screen'); } catch (e) {} }
async function endSharing(status) {
  if (!S.share) return;
  const s = S.share;
  try { await api('/api/location', { token: s.token, status }); } catch (e) {}
  if (S.watchId != null) { navigator.geolocation.clearWatch(S.watchId); S.watchId = null; }
  S.share = null; ls.del('blpShare');
  $('#shareBar').hidden = true;
  toast(status === 'arrived' ? 'Marked arrived — ' + s.customer + ' was told' : 'Stopped sharing');
  if ((location.hash || '#today') === '#today') renderToday();
}
$('#shareArrived').onclick = () => endSharing('arrived');
$('#shareStop').onclick = () => endSharing('ended');

/* ===================== DETAILS ===================== */
function renderDetails(m) {
  const id = encodeURIComponent(m.id);
  $('#main').innerHTML = `<div class="page">
    <a class="back" href="#today">‹ Today</a>
    <h1>${esc(m.customer)}</h1>
    <div class="rowk">
      <b>When</b><span>${esc(fmtShort(m.date))} · ${m.time ? esc(m.time) + (m.end ? '–' + esc(m.end) : '') : 'all day'}</span>
      <b>Piano</b><span>${esc(m.piano)}${m.serial && !m.piano.includes(m.serial) ? ' · SN ' + esc(m.serial) : ''}</span>
      ${m.from ? `<b>From</b><span>${esc(m.from)}</span>` : ''}
      ${m.to ? `<b>To</b><span>${esc(m.to)}</span>` : ''}
      ${m.location && !m.from && !m.to ? `<b>Where</b><span>${esc(m.location)}</span>` : ''}
      <b>Stairs</b><span>${m.stairs.text ? esc(m.stairs.text) : (m.stairs.none ? 'none' : 'not noted — ask when you text')}</span>
      <b>Bench</b><span>${m.bench ? esc(m.bench + (m.benchNote ? ' — ' + m.benchNote : '')) : 'not noted'}</span>
      ${m.price ? `<b>Quote</b><span>${esc(m.price)}${m.balance ? ' · collect ' + esc(m.balance) : ''}</span>` : ''}
      ${m.crew ? `<b>Crew</b><span>${esc(m.crew)}</span>` : ''}
      <b>Phone</b><span>${m.phone ? `<a href="${telUrl(m.phone)}">${esc(m.phone)}</a>` : '—'}</span>
    </div>
    <div class="btns">
      ${m.phone ? `<a class="btn" href="${telUrl(m.phone)}">Call</a>` : ''}
      <a class="btn nav" href="${m.nav ? mapsUrl(m.nav) : '#'}" target="_blank" rel="noopener">${pinIcon()} Navigate</a>
      <button class="btn" id="cpAddr">Copy address</button>
    </div>
    <div class="mlinks"><a href="#report/${id}">✎ Condition report</a><a href="#change/${id}">$ Move differs</a><a href="#offer/${id}">✦ Customer interested</a></div>
    ${prepList(m)}
    <details class="raw" open><summary>Calendar event</summary><pre>${esc(m.title)}\n${esc(m.location)}\n\n${esc(m.description || '(no description)')}</pre></details>
    ${m.done ? '<div class="lite">Marked done on the calendar.</div>' : `<button class="btn wide" id="markDone">✓ Mark this move done on the calendar</button>`}
    <div class="msg" id="dMsg"></div>
  </div>`;
  $('#cpAddr').onclick = () => copy(m.nav || m.location || '');
  const md = $('#markDone');
  if (md) md.onclick = async () => {
    md.disabled = true;
    if (!CFG.moversBridgeUrl) { setMsg('#dMsg', 'Example mode — connect the Movers bridge to write to the calendar.', 'err'); md.disabled = false; return; }
    const j = await bridgePost(CFG.moversBridgeUrl, { key: KEY(), action: 'markdone', eventId: m.eventId, who: S.me.name, what: 'Delivered' });
    if (j.ok) { m.done = true; toast('Marked done'); renderDetails(m); } else { setMsg('#dMsg', '✗ ' + j.error, 'err'); md.disabled = false; }
  };
}
function prepList(m) {
  const items = m.type === 'Grand'
    ? ['Skid board + grand straps', 'Leg & lyre removal kit (wrenches, pedal rod bag)', 'Lid lock / lid strap', '4-wheel dolly', 'Blankets: 8+', 'Door-jamb guards', 'Floor runners']
    : m.type === 'Digital' ? ['Stand hardware bag', 'Power cable + pedal unit', 'Blankets: 3', 'Hand truck'] : ['Piano board / upright dolly', 'Ratchet straps', 'Blankets: 5', 'Door-jamb guards', 'Floor runners', 'Stair-climber if flights'];
  if (m.stairs.warn) items.unshift('⚠ Flight of stairs — plan the crew, straps and rest stops');
  return `<h2>Prep for this piano <small>${esc(m.type || 'unknown type')}</small></h2><div class="road">${items.map(i => `<div><i>•</i><span>${esc(i)}</span></div>`).join('')}</div>`;
}

/* ===================== CONDITION REPORT ===================== */
const AREAS = {
  Grand: ['Lid & lid props', 'Music desk', 'Fallboard', 'Key slip', 'Cheek blocks', 'Key tops', 'Rim / sides', 'Leg 1 (bass)', 'Leg 2 (treble)', 'Leg 3 (tail)', 'Lyre & pedals', 'Casters / wheels', 'Underside / beams', 'Plate & strings (visible)'],
  Upright: ['Top lid', 'Upper front panel', 'Fallboard', 'Key slip', 'Key tops', 'Lower front panel', 'Side (left)', 'Side (right)', 'Back', 'Bottom board / toe blocks', 'Pedals', 'Casters / wheels'],
  Digital: ['Cabinet', 'Keys', 'Pedals / pedal unit', 'Stand', 'Power / cables / music rest'],
  Other: ['Top', 'Front', 'Sides', 'Back', 'Keys', 'Pedals', 'Legs / base', 'Casters'],
};
const STATES = ['Good', 'Scratch', 'Chip', 'Crack', 'Gouge', 'Loose', 'Missing'];
const FUNCS = ['All keys play', 'Pedals work', 'Lid props hold', 'Bench stable', 'Casters roll'];
const ACCS = ['Caster cups', 'Piano lamp', 'Music & books', 'Cover', 'Dolly left with piano', 'Lock key', 'Humidity system'];
function draftKey(m, stage) { return 'blpDraft:' + m.id + ':' + stage; }
function renderReport(m) {
  const id = encodeURIComponent(m.id);
  let R = ls.json(draftKey(m, 'any')) || {
    stage: m.kind === 'delivery' ? 'delivery' : 'pickup', type: m.type || 'Upright', make: (m.piano.match(new RegExp('(' + MAKES + ')', 'i')) || [])[1] || '', model: '', serial: m.serial || '', finish: '',
    bench: m.bench === 'no' ? 'No' : m.bench === 'yes' ? 'Yes' : '', benchType: '', benchNote: '', accessories: [],
    stairsActual: m.stairs.count || 0, stairsDir: m.stairs.dir || (m.stairs.none ? 'none' : ''), stairsFlights: m.stairs.flights || 0, access: '',
    condition: {}, functional: {}, notes: '', customerName: m.customer, ack: false,
  };
  const shots = []; let sig = null;
  const main = $('#main');
  const areas = () => AREAS[R.type] || AREAS.Other;
  function condRows() {
    return areas().map(a => {
      const c = R.condition[a] || { state: 'Good', note: '' };
      return `<div class="condrow ${c.state !== 'Good' ? 'flag' : ''}" data-a="${esc(a)}"><div class="lbl">${esc(a)}</div>
        <div class="seg red">${STATES.map(s => `<button type="button" class="${c.state === s ? 'on' : ''}" data-s="${s}">${s}</button>`).join('')}</div>
        ${c.state !== 'Good' ? `<textarea placeholder="Where exactly? size? (e.g. 2-inch scratch, left corner)">${esc(c.note)}</textarea>` : ''}</div>`;
    }).join('');
  }
  function paint() {
    main.innerHTML = `<div class="page">
      <a class="back" href="#details/${id}">‹ ${esc(m.customer)}</a>
      <h1>Condition report</h1>
      <p class="lite">${esc(m.customer)} · ${esc(m.piano)} · ${esc(fmtShort(m.date))}. Walk the piano with the customer before it moves; photograph anything you mark.</p>
      <div class="seg" id="stageSeg"><button type="button" data-v="pickup" class="${R.stage === 'pickup' ? 'on' : ''}">At pickup</button><button type="button" data-v="delivery" class="${R.stage === 'delivery' ? 'on' : ''}">At delivery</button></div>

      <h2>Piano</h2>
      <div class="seg" id="typeSeg">${['Grand', 'Upright', 'Digital', 'Other'].map(t => `<button type="button" data-v="${t}" class="${R.type === t ? 'on' : ''}">${t}</button>`).join('')}</div>
      <div class="grid2">
        <label class="fld">Make<input id="rMake" value="${esc(R.make)}" placeholder="Yamaha"></label>
        <label class="fld">Model<input id="rModel" value="${esc(R.model)}" placeholder="U1"></label>
        <label class="fld">Serial #<input id="rSerial" value="${esc(R.serial)}" placeholder="from the plate"></label>
        <label class="fld">Finish / color<input id="rFinish" value="${esc(R.finish)}" placeholder="polished ebony"></label>
      </div>

      <h2>Bench</h2>
      <div class="seg" id="benchSeg"><button type="button" data-v="Yes" class="${R.bench === 'Yes' ? 'on' : ''}">Bench: yes</button><button type="button" data-v="No" class="${R.bench === 'No' ? 'on' : ''}">No bench</button></div>
      ${R.bench === 'Yes' ? `<div class="seg" id="benchTypeSeg">${['Matching', 'Adjustable', 'Artist', 'Other'].map(t => `<button type="button" data-v="${t}" class="${R.benchType === t ? 'on' : ''}">${t}</button>`).join('')}</div>
      <label class="fld">Bench condition<input id="rBenchNote" value="${esc(R.benchNote)}" placeholder="good / scratched top / wobbly leg"></label>` : ''}

      <h2>Also moving <small>tap what goes with the piano</small></h2>
      <div class="seg good" id="accSeg">${ACCS.map(a => `<button type="button" data-v="${esc(a)}" class="${R.accessories.includes(a) ? 'on' : ''}">${esc(a)}</button>`).join('')}</div>

      <h2>Site <small>${m.stairs.text ? 'booked: ' + esc(m.stairs.text) : 'nothing booked about stairs'}</small></h2>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <div class="stepper"><button type="button" id="stMinus">−</button><input id="rStairs" inputmode="numeric" value="${R.stairsActual}"><button type="button" id="stPlus">+</button></div>
        <span class="lite">actual stairs</span>
        <div class="seg" id="dirSeg">${[['up', 'Up'], ['down', 'Down'], ['none', 'None']].map(([v, l]) => `<button type="button" data-v="${v}" class="${R.stairsDir === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      <label class="fld">Path & access<textarea id="rAccess" placeholder="door width, turns, landing, flooring, long carry, parking">${esc(R.access)}</textarea></label>

      <h2>Condition <small>mark anything already there</small></h2>
      <div class="cond" id="cond">${condRows()}</div>

      <h2>Works?</h2>
      <div class="cond">${FUNCS.map(f => `<div class="condrow" data-f="${esc(f)}"><div class="lbl">${esc(f)}</div><div class="seg good">${['Yes', 'No', 'Not checked'].map(v => `<button type="button" data-v="${v}" class="${(R.functional[f] || '') === v ? 'on' : ''}">${v}</button>`).join('')}</div></div>`).join('')}</div>

      <h2>Photos & video <small>${shots.length ? shots.length + ' added' : 'add several angles'}</small></h2>
      <div class="shots" id="shots">${shots.map((s, i) => `<div class="shot">${s.kind === 'video' ? `<video src="${s.url}" muted playsinline></video><span class="vid">▶</span>` : `<img src="${s.url}" alt="">`}<span class="tag">${esc(s.tag)}</span><button type="button" class="x" data-i="${i}">✕</button></div>`).join('')}
        <label class="addshot"><span>📷</span>Photo<input type="file" accept="image/*" capture="environment" multiple data-tag="Photo"></label>
        <label class="addshot"><span>⚠</span>Damage<input type="file" accept="image/*" capture="environment" multiple data-tag="Damage"></label>
        <label class="addshot"><span>🎥</span>Video<input type="file" accept="video/*" capture="environment" data-tag="Video"></label>
        <label class="addshot"><span>🖼</span>From library<input type="file" accept="image/*,video/*" multiple data-tag="Photo"></label>
      </div>

      <h2>Notes</h2>
      <label class="fld">Anything else<textarea id="rNotes" placeholder="e.g. customer pointed out the old water ring on the lid">${esc(R.notes)}</textarea></label>

      <h2>Customer sign-off</h2>
      <label class="fld">Customer name<input id="rCust" value="${esc(R.customerName)}"></label>
      <canvas class="sigpad" id="sig"></canvas>
      <div class="sigrow"><span>Sign above with a finger</span><button type="button" id="sigClear">Clear</button></div>
      <label class="check"><input type="checkbox" id="rAck" ${R.ack ? 'checked' : ''}> Customer reviewed and agrees with the condition noted above</label>

      <div class="progress" id="prog" hidden><i></i></div>
      <button class="btn eta wide" id="rSend">Save report${shots.length ? ' + upload ' + shots.length + ' file' + (shots.length === 1 ? '' : 's') : ''}</button>
      <div class="msg" id="rMsg"></div>
      <div class="lite">Photos and video are filed in Google Drive under this customer with the calendar details, and a row is added to the Condition Reports sheet.</div>
    </div>`;
    wire();
  }
  function save() { ls.set(draftKey(m, 'any'), JSON.stringify(R)); }
  function segWire(sel, on) { const el = $(sel); if (!el) return; $$('button', el).forEach(b => b.onclick = () => { on(b.dataset.v); save(); paint(); }); }
  function wire() {
    segWire('#stageSeg', v => R.stage = v);
    segWire('#typeSeg', v => R.type = v);
    segWire('#benchSeg', v => R.bench = v);
    segWire('#benchTypeSeg', v => R.benchType = v);
    segWire('#dirSeg', v => R.stairsDir = v);
    const acc = $('#accSeg'); $$('button', acc).forEach(b => b.onclick = () => { const v = b.dataset.v; R.accessories = R.accessories.includes(v) ? R.accessories.filter(x => x !== v) : [...R.accessories, v]; b.classList.toggle('on'); save(); });
    ['rMake:make', 'rModel:model', 'rSerial:serial', 'rFinish:finish', 'rBenchNote:benchNote', 'rAccess:access', 'rNotes:notes', 'rCust:customerName'].forEach(p => { const [i, k] = p.split(':'); const el = $('#' + i); if (el) el.oninput = () => { R[k] = el.value; save(); }; });
    $('#rAck').onchange = e => { R.ack = e.target.checked; save(); };
    const st = $('#rStairs');
    st.oninput = () => { R.stairsActual = Math.max(0, +st.value || 0); save(); };
    $('#stMinus').onclick = () => { R.stairsActual = Math.max(0, R.stairsActual - 1); st.value = R.stairsActual; save(); };
    $('#stPlus').onclick = () => { R.stairsActual++; st.value = R.stairsActual; save(); };
    $$('#cond .condrow').forEach(row => {
      const a = row.dataset.a;
      $$('.seg button', row).forEach(b => b.onclick = () => { R.condition[a] = { state: b.dataset.s, note: (R.condition[a] || {}).note || '' }; save(); paint(); });
      const ta = $('textarea', row); if (ta) ta.oninput = () => { R.condition[a].note = ta.value; save(); };
    });
    $$('.condrow[data-f]').forEach(row => { const f = row.dataset.f; $$('button', row).forEach(b => b.onclick = () => { R.functional[f] = b.dataset.v; $$('button', row).forEach(x => x.classList.toggle('on', x === b)); save(); }); });
    $$('#shots input[type=file]').forEach(inp => inp.onchange = async () => {
      for (const f of inp.files) {
        const kind = f.type.startsWith('video') ? 'video' : 'image';
        const url = kind === 'video' ? URL.createObjectURL(f) : await downscale(f, 400, 0.7).catch(() => URL.createObjectURL(f));
        shots.push({ file: f, kind, tag: kind === 'video' ? 'Video' : inp.dataset.tag, url });
      }
      inp.value = ''; paint();
    });
    $$('#shots .x').forEach(x => x.onclick = () => { shots.splice(+x.dataset.i, 1); paint(); });
    sig = sigPad($('#sig'), sig);
    $('#sigClear').onclick = () => sig.clear();
    $('#rSend').onclick = submit;
  }
  async function submit() {
    const btn = $('#rSend'); btn.disabled = true;
    const prog = $('#prog'); prog.hidden = false; const bar = $('i', prog);
    const set = (p, t) => { bar.style.width = p + '%'; setMsg('#rMsg', t); };
    try {
      const flags = Object.entries(R.condition).filter(([, v]) => v.state !== 'Good').map(([k, v]) => `${k}: ${v.state}${v.note ? ' (' + v.note + ')' : ''}`);
      const report = { ...R, flags, stairsActual: `${R.stairsActual} ${R.stairsDir === 'none' ? '' : R.stairsDir}`.trim() + (R.stairsFlights ? ` · ${R.stairsFlights} flight(s)` : ''), signature: sig.isEmpty() ? '' : sig.png().split(',')[1] };
      const move = { eventId: m.eventId, date: m.date, time: m.time, customer: m.customer, phone: m.phone, piano: m.piano, from: m.from, to: m.to, stairsText: m.stairs.text, bench: m.bench, crew: m.crew, title: m.title, location: m.location, description: m.description };
      const photos = [];
      const imgs = shots.filter(s => s.kind === 'image'), vids = shots.filter(s => s.kind === 'video');
      for (let i = 0; i < imgs.length; i++) {
        set(5 + 40 * (i / Math.max(1, imgs.length)), `Preparing photo ${i + 1} of ${imgs.length}…`);
        const d = await downscale(imgs[i].file, 1800, 0.86);
        photos.push({ tag: imgs[i].tag.toLowerCase(), mime: 'image/jpeg', data: d.split(',')[1] });
      }
      let result = { ok: true, demo: true };
      if (CFG.moversBridgeUrl) {
        set(50, 'Uploading to Google Drive…');
        result = await bridgePost(CFG.moversBridgeUrl, { key: KEY(), action: 'report', who: S.me.name, stage: R.stage, move, report, photos }, 2);
        if (!result.ok) throw new Error(result.error || 'upload failed');
        for (let i = 0; i < vids.length; i++) {
          set(70 + 25 * (i / vids.length), `Uploading video ${i + 1} of ${vids.length}…`);
          const v = vids[i].file;
          const sess = await bridgePost(CFG.moversBridgeUrl, { key: KEY(), action: 'videosession', move, name: `${R.stage}-video-${String(i + 1).padStart(2, '0')}.${(v.name.split('.').pop() || 'mp4').toLowerCase()}`, mime: v.type || 'video/mp4', origin: location.origin }, 2);
          if (!sess.ok) throw new Error('video: ' + sess.error);
          const put = await fetch(sess.sessionUrl, { method: 'PUT', headers: { 'content-type': v.type || 'video/mp4' }, body: v });
          if (!put.ok) throw new Error('video upload ' + put.status);
        }
      } else if (vids.length) toast('Example mode: videos need the Movers bridge', true);
      set(96, 'Logging…');
      await api('/api/log', { kind: 'report', who: S.me.name, data: { moveId: m.id, customer: m.customer, piano: m.piano, date: m.date, stage: R.stage, bench: R.bench, flags, photos: photos.length, videos: vids.length, folderUrl: result.folderUrl || '', signed: !sig.isEmpty(), demo: !CFG.moversBridgeUrl } }).catch(() => {});
      set(100, '');
      ls.del(draftKey(m, 'any'));
      toast(result.demo ? 'Report saved to the app log (example mode)' : 'Report filed — ' + photos.length + ' photo' + (photos.length === 1 ? '' : 's') + ' in Drive');
      $('#main').innerHTML = `<div class="page"><a class="back" href="#today">‹ Today</a><h1>Report filed</h1>
        <p>${esc(m.customer)} · ${esc(R.stage)} · ${flags.length ? flags.length + ' item' + (flags.length === 1 ? '' : 's') + ' flagged' : 'no damage noted'} · ${photos.length} photo${photos.length === 1 ? '' : 's'}${vids.length ? ' · ' + vids.length + ' video' + (vids.length === 1 ? '' : 's') : ''}.</p>
        ${result.folderUrl ? `<a class="btn wide" target="_blank" rel="noopener" href="${esc(result.folderUrl)}">Open the Drive folder</a>` : '<div class="demo">Example mode — nothing was uploaded. Connect the Movers bridge in config.js.</div>'}
        ${R.stage === 'pickup' ? `<a class="btn wide sm" href="#report/${id}">Start the delivery report</a>` : `<a class="btn wide sm" href="#offer/${id}">✦ Customer interested in a service or product?</a>`}
        <a class="btn eta wide" href="#today">Back to today</a></div>`;
    } catch (e) { setMsg('#rMsg', '✗ ' + e.message, 'err'); btn.disabled = false; prog.hidden = true; }
  }
  paint();
}
function downscale(file, max, q) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', q));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('cannot read image')); };
    img.src = url;
  });
}
function sigPad(canvas, prev) {
  const ratio = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 320, h = 150;
  canvas.width = w * ratio; canvas.height = h * ratio;
  const ctx = canvas.getContext('2d'); ctx.scale(ratio, ratio); ctx.lineWidth = 2.2; ctx.lineCap = 'round'; ctx.strokeStyle = '#151515';
  let empty = true, drawing = false, last = null;
  if (prev && !prev.isEmpty()) { const im = new Image(); im.onload = () => { ctx.drawImage(im, 0, 0, w, h); empty = false; }; im.src = prev.png(); }
  const pt = e => { const r = canvas.getBoundingClientRect(); const t = e.touches ? e.touches[0] : e; return { x: t.clientX - r.left, y: t.clientY - r.top }; };
  const down = e => { drawing = true; last = pt(e); e.preventDefault(); };
  const move = e => { if (!drawing) return; const p = pt(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; empty = false; e.preventDefault(); };
  const up = () => { drawing = false; };
  canvas.onpointerdown = down; canvas.onpointermove = move; canvas.onpointerup = up; canvas.onpointerleave = up;
  return { clear() { ctx.clearRect(0, 0, w, h); empty = true; }, isEmpty: () => empty, png: () => canvas.toDataURL('image/png') };
}

/* ===================== CHANGE ORDER ===================== */
const PRICING = [
  { k: 'flight', label: 'Extra flight of stairs', sub: 'per full flight not on the booking', amount: 75 },
  { k: 'stairs', label: 'Extra stairs', sub: 'per 5 stairs, when it is not a full flight', amount: 25 },
  { k: 'carry', label: 'Long carry', sub: 'over 75 ft from the truck', amount: 50 },
  { k: 'bigger', label: 'Bigger piano than booked', sub: 'e.g. booked as upright, it is a grand', amount: 150 },
  { k: 'second', label: 'Second piano / extra item', sub: 'bench, organ, safe…', amount: 200 },
  { k: 'tight', label: 'Tight turn, hoist, or door removal', sub: 'extra rigging on site', amount: 100 },
  { k: 'wait', label: 'Wait time', sub: 'per 15 minutes waiting on the customer', amount: 25 },
  { k: 'stop', label: 'Extra stop / address change', sub: 'a stop not on the booking', amount: 60 },
];
function renderChange(m) {
  const id = encodeURIComponent(m.id);
  const q = {}; let custom = { label: '', amount: 0 }; let reason = ''; let agreed = false; let sig = null;
  const main = $('#main');
  const total = () => PRICING.reduce((a, p) => a + (q[p.k] || 0) * p.amount, 0) + (+custom.amount || 0);
  function paint() {
    main.innerHTML = `<div class="page">
      <a class="back" href="#details/${id}">‹ ${esc(m.customer)}</a>
      <h1>Move differs from the booking</h1>
      <p class="lite">Booked: ${esc(m.piano)}${m.stairs.text ? ' · ' + esc(m.stairs.text) : ' · no stairs noted'}${m.price ? ' · ' + esc(m.price) : ''}. Tap what is different; the customer sees the added amount and signs.</p>
      <div class="lines">${PRICING.map(p => `<div class="line"><div class="lt">${esc(p.label)}<small>${esc(p.sub)} · $${p.amount}</small></div>
        <div style="display:flex;align-items:center;gap:8px"><div class="stepper"><button type="button" data-k="${p.k}" data-d="-1">−</button><input readonly value="${q[p.k] || 0}"><button type="button" data-k="${p.k}" data-d="1">+</button></div><span class="amt">${q[p.k] ? '$' + q[p.k] * p.amount : ''}</span></div></div>`).join('')}
        <div class="line"><label class="fld" style="flex:1">Other<input id="coLabel" value="${esc(custom.label)}" placeholder="describe it"></label><label class="fld" style="width:96px">Amount<input id="coAmt" inputmode="decimal" value="${custom.amount || ''}" placeholder="$"></label></div>
        <div class="line total"><div class="lt">Added to the move</div><div class="amt">$${total()}</div></div>
      </div>
      <label class="fld">What happened<textarea id="coReason" placeholder="e.g. 14 stairs to the front door were not on the booking">${esc(reason)}</textarea></label>
      <h2>Customer approval</h2>
      <label class="check"><input type="checkbox" id="coAgree" ${agreed ? 'checked' : ''}> ${esc(m.customer)} agrees to the added $<span id="coTot">${total()}</span></label>
      <canvas class="sigpad" id="coSig"></canvas>
      <div class="sigrow"><span>Customer signs here</span><button type="button" id="coSigClear">Clear</button></div>
      <button class="btn eta wide" id="coSend" ${total() ? '' : 'disabled'}>File change order · $${total()}</button>
      <div class="msg" id="coMsg"></div>
      <div class="lite">The office is texted right away, the amount is noted on the calendar event, and a row is added to the Change Orders sheet. Prices are the defaults in app.js until the office sets them.</div>
    </div>`;
    $$('.stepper button', main).forEach(b => b.onclick = () => { q[b.dataset.k] = Math.max(0, (q[b.dataset.k] || 0) + +b.dataset.d); const keep = { reason: $('#coReason').value, l: $('#coLabel').value, a: $('#coAmt').value }; reason = keep.reason; custom = { label: keep.l, amount: +keep.a || 0 }; paint(); });
    $('#coLabel').oninput = e => { custom.label = e.target.value; };
    $('#coAmt').onchange = e => { custom.amount = +e.target.value || 0; reason = $('#coReason').value; paint(); };
    $('#coReason').oninput = e => { reason = e.target.value; };
    $('#coAgree').onchange = e => { agreed = e.target.checked; };
    sig = sigPad($('#coSig'), sig);
    $('#coSigClear').onclick = () => sig.clear();
    $('#coSend').onclick = async () => {
      const btn = $('#coSend'); btn.disabled = true;
      const items = PRICING.filter(p => q[p.k]).map(p => ({ label: p.label, qty: q[p.k], amount: q[p.k] * p.amount }));
      if (custom.amount) items.push({ label: custom.label || 'Other', qty: 1, amount: +custom.amount });
      const order = { items, total: total(), reason, agreed, customerName: m.customer, signature: sig.isEmpty() ? '' : sig.png().split(',')[1] };
      const move = { eventId: m.eventId, date: m.date, customer: m.customer, phone: m.phone, piano: m.piano };
      try {
        if (CFG.moversBridgeUrl) { const j = await bridgePost(CFG.moversBridgeUrl, { key: KEY(), action: 'changeorder', who: S.me.name, move, order }); if (!j.ok) throw new Error(j.error); }
        await api('/api/log', { kind: 'change', who: S.me.name, data: { moveId: m.id, customer: m.customer, piano: m.piano, date: m.date, items, total: order.total, reason, agreed } }).catch(() => {});
        toast('Change order filed · $' + order.total);
        const summary = `Hi ${m.customer.split(' ')[0]}, here is the change to today's move from ${CFG.shopName}: ${items.map(i => i.label + (i.qty > 1 ? ' ×' + i.qty : '') + ' $' + i.amount).join(', ')}. Added total: $${order.total}. Thank you!`;
        main.innerHTML = `<div class="page"><a class="back" href="#today">‹ Today</a><h1>Filed · $${order.total}</h1><p>${items.map(i => esc(i.label) + (i.qty > 1 ? ' ×' + i.qty : '')).join(', ')}.</p>
          ${CFG.moversBridgeUrl ? '<p class="lite">The office has been texted and the calendar event now carries the amount.</p>' : '<div class="demo">Example mode — logged in the app only. Connect the Movers bridge to text the office and update the calendar.</div>'}
          ${m.phone ? `<a class="btn wide" href="${smsUrl(m.phone, summary)}">Text ${esc(m.customer)} the summary</a>` : ''}
          <a class="btn eta wide" href="#today">Back to today</a></div>`;
      } catch (e) { setMsg('#coMsg', '✗ ' + e.message, 'err'); btn.disabled = false; }
    };
  }
  paint();
}

/* ===================== PIANO CARE & SERVICES (offers, on-site sales, mover bonuses) =====================
 * Each item has the marketing text the customer receives, an on-site price
 * when the truck can sell it right there, and the mover's bonus when the
 * office closes it. BONUS amounts are placeholders until the office sets
 * them — edit them here (or move them to App Settings later). */
const BONUS_NOTE = 'Bonus amounts are placeholders until the office sets them.';
const SITE = 'https://www.brighamlarsonpianos.com';
// text = what the customer receives: two short sentences + a link to the
// service page (video, photos, pricing, book button live there). image = an
// optional MMS photo URL (leave blank to send plain SMS). Fill in from the
// site as the office picks the hero image per service.
const CATALOG = [
  { id: 'tuning', s: 'Tuning', kind: 'service', when: 'Every move · 2–4 weeks after delivery', for: ['Grand', 'Upright'], bonus: 10, url: SITE + '/pages/piano-services', image: '',
    why: 'Moving and a new room knock a piano out of tune. BLP tunes it once it has settled.',
    say: '"Give it a few weeks to settle, then we\'ll come tune it so it sounds like it did in the showroom. Want me to have the office set that up?"',
    text: 'Hi {first}, this is {mover} with Brigham Larson Pianos — thank you for having us today! Your piano will settle into its new room over the next few weeks, and then it\'s ready for its first tuning. Book it here or reply YES and we\'ll call: {url}' },
  { id: 'player', s: 'QRS player system add-on', kind: 'service', when: 'Any acoustic piano · entertaining · families', for: ['Grand', 'Upright'], bonus: 75, url: SITE + '/pages/digital-player-piano-technology', image: '',
    why: 'A QRS self-playing system fits any grand or upright. It plays from an app over home Wi-Fi with playlists, streamed music, and background ambiance for events. High-value install.',
    say: '"Did you know this piano can play itself? We install a QRS system that runs from your phone — it\'s amazing for parties. Want to see a 30-second video?"',
    text: 'Hi {first}, {mover} with Brigham Larson Pianos. Your piano can play itself: a QRS player system installs on any grand or upright and plays from an app on your phone — dinner music, holidays, kids\' favorites. Watch it in action: {url}' },
  { id: 'silent', s: 'Silent Play technology', kind: 'service', when: 'Shared walls · early or late practice · kids', for: ['Grand', 'Upright'], bonus: 50, url: SITE + '/pages/piano-services', image: '',
    why: 'Silent Play lets them practice on their real acoustic piano through headphones, any hour, with a concert-grand sound. Perfect for townhomes, apartments, and late-night practicers.',
    say: '"With the neighbors this close, a Silent system lets you practice at midnight with headphones and nobody hears a thing — it\'s your real piano, same touch."',
    text: 'Hi {first}, {mover} from Brigham Larson Pianos. Practice at any hour without waking the house: Silent Play adds headphones to your real acoustic piano — same keys and touch, concert-grand sound only you hear. See how it works: {url}' },
  { id: 'acrylickeys', s: 'New acrylic keytops', kind: 'service', when: 'Chipped, yellowed, or mismatched keys', for: ['Grand', 'Upright'], bonus: 20, url: SITE + '/pages/piano-services', image: '',
    why: 'A full set of new acrylic keytops, fitted and leveled in the BLP shop. The most visible upgrade on an older piano.',
    say: '"A few of these keytops are chipped and yellowed. Our shop fits a whole new set — the keyboard looks brand new."',
    text: 'Hi {first}, {mover} with Brigham Larson Pianos. A brand-new set of acrylic keytops, fitted and leveled in our shop, makes an older keyboard look and feel new again. Before-and-afters and pricing here: {url}' },
  { id: 'ivoryrepair', s: 'Ivory keytop repair', kind: 'service', when: 'Vintage pianos with real ivory', for: ['Grand', 'Upright'], bonus: 20, url: SITE + '/pages/piano-restoration', image: '',
    why: 'Real ivory is worth keeping. BLP re-glues lifted tops, replaces missing pieces from matched stock, and re-polishes the set.',
    say: '"These are real ivories — worth keeping. Our shop can replace the missing ones from matched stock and polish the whole set."',
    text: 'Hi {first}, {mover} from Brigham Larson Pianos. Your piano has real ivory keys — worth preserving. Our shop repairs lifted and missing ivories from matched stock and polishes the set so it looks original. Details here: {url}' },
  { id: 'castercups', s: 'Caster cups', kind: 'product', price: 25, when: 'Hardwood or tile floors', for: ['Grand', 'Upright'], bonus: 3, url: SITE + '/pages/piano-services', image: '',
    why: 'Protects the floor and stops the piano from creeping. Sold from the truck, on the spot.',
    say: '"On this hardwood you\'ll want caster cups under the wheels — we have them in the truck."',
    text: 'Hi {first}, {mover} with Brigham Larson Pianos. Caster cups under the wheels protect your floor and keep the piano from creeping. We carry them on the truck — reply YES and we\'ll bring a set, or call {phone}.' },
  { id: 'refinishing', s: 'Refinishing', kind: 'service', when: 'Worn, scratched, or dated finish', for: ['Grand', 'Upright'], bonus: 100, url: SITE + '/pages/piano-refinishing', image: '',
    why: 'Full strip and refinish in the BLP shop: new color or sheen, high-gloss conversion, replated hardware. A tired cabinet becomes a showpiece.',
    say: '"The finish is worn but the piano is solid. Our shop refinishes these — you could even go high-gloss black or a new color. Want to see examples?"',
    text: 'Hi {first}, {mover} from Brigham Larson Pianos. Your piano\'s finish has seen some life, but the instrument is solid — our shop refinishes pianos in any color or sheen, including high-gloss. Browse before-and-afters here: {url}' },
  { id: 'heirloom', s: 'Heirloom family restoration', kind: 'service', when: 'Grandma\'s piano · sentimental pianos', for: ['Grand', 'Upright'], bonus: 150, url: SITE + '/pages/family-heirloom-piano-legacy-stories-restorations', image: '',
    why: 'BLP\'s signature service: the family piano fully restored so the next generation plays it. Emotional, high-value, and the story gets featured.',
    say: '"This was your grandmother\'s? BLP restores family heirlooms like this from the inside out — they even tell the family\'s story on the site."',
    text: 'Hi {first}, {mover} with Brigham Larson Pianos. A family piano like yours deserves to be played for another generation. Our heirloom restoration brings it back inside and out, and we love telling each family\'s story. See a few of them here: {url}' },
  { id: 'refurbishing', s: 'Refurbishing', kind: 'service', when: 'Older pianos that play but feel tired', for: ['Grand', 'Upright'], bonus: 60, url: SITE + '/pages/piano-restoration', image: '',
    why: 'Short of a full rebuild: regulation, voicing, cleaning, new felts and strings where needed. Restores the touch and tone at a fraction of restoration.',
    say: '"Some of these keys feel uneven and the tone is a little harsh — a refurbish in our shop evens the touch and brightens it up."',
    text: 'Hi {first}, {mover} from Brigham Larson Pianos. A refurbish brings back an even touch and a warm, clear tone without a full rebuild — regulation, voicing, cleaning, and fresh parts where needed. What\'s included: {url}' },
  { id: 'humidity', s: 'Humidity control (Piano Life Saver)', kind: 'service', when: 'Dry homes · wood stoves · basements', for: ['Grand', 'Upright'], bonus: 25, url: SITE + '/pages/piano-services', image: '',
    why: 'Utah air is dry. A Dampp-Chaser system under the piano keeps the soundboard stable, so it stays in tune longer and cracks less.',
    say: '"This room gets pretty dry in winter. A humidity system underneath keeps it in tune and protects the soundboard. It\'s a one-time install."',
    text: 'Hi {first}, {mover} from Brigham Larson Pianos. Utah\'s dry air is the #1 thing that pushes pianos out of tune and cracks soundboards. A Piano Life Saver system installs under your piano once and protects it year-round. Learn more or reply YES: {url}' },
  { id: 'bench', s: 'Bench', kind: 'product', price: 0, when: 'No bench, or a wobbly one', for: ['Grand', 'Upright', 'Digital'], bonus: 15, url: SITE + '/pages/piano-services', image: '',
    why: 'A matching or adjustable artist bench finishes the piano. Sold from the showroom; the office confirms the finish and price.',
    say: '"There\'s no bench coming with this one — we have matching and adjustable benches at the store. Want a photo of the options?"',
    text: 'Hi {first}, {mover} with Brigham Larson Pianos. We have matching and adjustable artist benches in stock that fit your piano\'s finish. Reply YES and our office will text you photos and prices, or call {phone}.' },
  { id: 'polishkit', s: 'Piano polish & cleaning kit', kind: 'product', price: 30, when: 'Any high-gloss or satin finish', for: ['Grand', 'Upright', 'Digital'], bonus: 3, url: '', image: '',
    why: 'The right polish for the finish, sold from the truck. Household cleaners haze lacquer.',
    say: '"Household sprays haze this finish — we carry the polish the shop uses. Want a kit?"',
    text: 'Hi {first}, {mover} from Brigham Larson Pianos. Household sprays can haze a piano finish; we carry the polish and cloths our shop uses. Reply YES and we\'ll bring a kit, or call {phone}.' },
  { id: 'lessons', s: 'Utah Piano Conservatory lessons', kind: 'service', when: 'Kids · first piano', for: ['Grand', 'Upright', 'Digital'], bonus: 20, url: SITE, image: '',
    why: 'BLP runs the Utah Piano Conservatory. A family with a new piano and no teacher is a warm lead.',
    say: '"Is someone taking lessons? The Conservatory is right at the store — I can have them call you."',
    text: 'Hi {first}, {mover} from Brigham Larson Pianos. Congratulations on the new piano! The Utah Piano Conservatory, right at our store, has openings for beginners and returning players of all ages. Reply YES and the Conservatory will reach out about a first lesson, or call {phone}.' },
];
const money = n => '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 0 });
function fillText(t, m, svc) {
  const first = (m && m.customer ? m.customer.split(/\s+/)[0] : 'there');
  return t.replace(/{first}/g, first).replace(/{mover}/g, S.me.name.split(' ')[0]).replace(/{phone}/g, CFG.shopPhone || '').replace(/{shop}/g, CFG.shopName || '').replace(/{service}/g, svc.s).replace(/{url}/g, svc.url || '');
}
let bonusCache = null;
async function bonusStrip() {
  try {
    const j = await fetch('/api/offer?key=' + encodeURIComponent(KEY()) + '&who=' + encodeURIComponent(S.me.name)).then(r => r.json());
    if (j.ok) bonusCache = j;
  } catch (e) {}
  const el = $('#bonusStrip'); if (!el) return;
  if (!bonusCache) { el.innerHTML = `<b>Your bonuses</b><span>tallies appear once the site is live</span>`; return; }
  el.innerHTML = `<b>Your bonuses</b><span><em>${money(bonusCache.earned || 0)}</em> earned · <em>${money(bonusCache.pending || 0)}</em> pending on ${bonusCache.open || 0} open offer${bonusCache.open === 1 ? '' : 's'}</span>`;
}
function renderServices(m, type) {
  type = type || (m && m.type) || '';
  const list = CATALOG.filter(u => !type || u.for.includes(type));
  const id = m ? encodeURIComponent(m.id) : '';
  $('#main').innerHTML = `<div class="page">
    ${m ? `<a class="back" href="#details/${id}">‹ ${esc(m.customer)}</a>` : ''}
    <h1>${m ? 'What is ' + esc(m.customer.split(/\s+/)[0]) + ' interested in?' : 'Piano care & services'}${type ? ` <small class="lite">for a ${esc(type.toLowerCase())}</small>` : ''}</h1>
    <p class="lite">${m ? 'Tap the item. The customer gets a friendly text about it, a lead opens in the Sales App with you as the source, and your bonus is tracked. Truck items can be sold on the spot.' : 'Every piano needs a little care after a move. If something fits, mention it and note their interest. The office takes it from there.'}</p>
    <div class="bonus" id="bonusStrip"><b>Your bonuses</b><span>…</span></div>
    ${!type ? `<div class="seg" id="typeFilter">${['All', 'Grand', 'Upright', 'Digital'].map(t => `<button type="button" data-v="${t === 'All' ? '' : t}" class="${(type || '') === (t === 'All' ? '' : t) ? 'on' : ''}">${t}</button>`).join('')}</div>` : ''}
    <div class="ups">${list.map(u => `<div class="up"><div class="uphead"><div class="when">${esc(u.when)}</div><span class="bchip" title="${esc(BONUS_NOTE)}">Bonus ${money(u.bonus)}</span></div><b>${esc(u.s)}</b>${u.kind === 'product' && u.price ? `<div class="lite">On the truck · ${money(u.price)}</div>` : ''}<p>${esc(u.why)}</p>${u.url ? `<a class="uplink" href="${esc(u.url)}" target="_blank" rel="noopener">Show the customer the page ↗</a>` : ''}<div class="say">${esc(u.say)}</div>
      <div class="act"><button class="btn sm eta" data-offer="${u.id}">${msgIcon()} Text the offer</button>${u.kind === 'product' ? `<button class="btn sm" data-sold="${u.id}">Sold on site</button>` : `<button class="btn sm" data-interest="${u.id}">Just note interest</button>`}</div></div>`).join('')}</div>
    <div class="lite">${esc(BONUS_NOTE)}</div>
  </div>`;
  bonusStrip();
  const tf = $('#typeFilter'); if (tf) $$('button', tf).forEach(b => b.onclick = () => { location.hash = '#services/' + encodeURIComponent(b.dataset.v); });
  const pick = (u, mode) => m ? offerSheet(m, u, mode) : whichCustomer(u, mode);
  $$('[data-offer]').forEach(b => b.onclick = () => pick(CATALOG.find(u => u.id === b.dataset.offer), 'text'));
  $$('[data-sold]').forEach(b => b.onclick = () => pick(CATALOG.find(u => u.id === b.dataset.sold), 'sold'));
  $$('[data-interest]').forEach(b => b.onclick = () => pick(CATALOG.find(u => u.id === b.dataset.interest), 'note'));
}
function whichCustomer(u, mode) {
  const todays = S.moves;
  const b = sheet(`<h3>${esc(u.s)}</h3><div class="lite">Which customer?</div>
    <label class="fld">Customer<select id="wcMove">${todays.map(m => `<option value="${esc(m.id)}">${esc(m.customer)} · ${esc(m.piano)}</option>`).join('')}<option value="">Someone else…</option></select></label>
    <div id="wcOther" hidden class="grid2"><label class="fld">Name<input id="wcName" placeholder="First Last"></label><label class="fld">Phone<input id="wcPhone" type="tel" placeholder="801-555-0100"></label></div>
    <button class="btn eta wide" id="wcGo">Continue</button>`);
  const sel = $('#wcMove', b);
  sel.onchange = () => { $('#wcOther', b).hidden = !!sel.value; };
  if (!todays.length) { sel.value = ''; $('#wcOther', b).hidden = false; }
  $('#wcGo', b).onclick = () => {
    let m = S.all[sel.value];
    if (!m) { const name = $('#wcName', b).value.trim(); if (!name) return toast('Add a name', true); m = { id: 'adhoc-' + Date.now(), customer: name, phone: $('#wcPhone', b).value.trim(), piano: '', type: '', date: today(), eventId: '' }; }
    offerSheet(m, u, mode);
  };
}
function offerSheet(m, u, mode) {
  const text = fillText(u.text, m, u);
  const b = sheet(`<h3>${esc(u.s)}</h3><div class="lite">${esc(m.customer)}${m.piano ? ' · ' + esc(m.piano) : ''} · <span class="bchip">Bonus ${money(u.bonus)}</span></div>
    <div class="seg" id="modeSeg"><button type="button" data-v="text" class="${mode === 'text' ? 'on' : ''}">Text the offer</button>${u.kind === 'product' ? `<button type="button" data-v="sold" class="${mode === 'sold' ? 'on' : ''}">Sold on site</button>` : ''}<button type="button" data-v="note" class="${mode === 'note' ? 'on' : ''}">Note interest only</button></div>
    <label class="fld">Customer phone<input id="ofPhone" type="tel" value="${esc(m.phone || '')}" placeholder="801-555-0100"></label>
    <div id="ofText" ${mode === 'text' ? '' : 'hidden'}><label class="fld">Message they receive<textarea id="ofBody" maxlength="480" style="min-height:150px">${esc(text)}</textarea></label></div>
    <div id="ofSold" ${mode === 'sold' ? '' : 'hidden'} class="grid2">
      <label class="fld">Amount collected<input id="ofAmt" inputmode="decimal" value="${u.price || ''}" placeholder="$"></label>
      <label class="fld">Quantity<input id="ofQty" inputmode="numeric" value="1"></label>
      <label class="fld" style="grid-column:1/-1">Paid by<select id="ofPay"><option>Card (reader)</option><option>Cash</option><option>Venmo</option><option>Office will invoice</option></select></label>
    </div>
    <label class="fld">Note for the office<textarea id="ofNote" placeholder="what they said, best time to reach them"></textarea></label>
    <button class="btn eta wide" id="ofGo">${mode === 'sold' ? 'Record the sale' : mode === 'text' ? 'Send text + open lead' : 'Note it + open lead'}</button>
    <div class="msg" id="ofMsg"></div>
    <div class="lite">A lead opens in the BLP Sales App with <b>${esc(S.me.name)}</b> as the source, so the bonus is yours when it closes.${u.kind === 'product' ? ' On-site sales count as closed right away.' : ''}</div>`);
  $$('#modeSeg button', b).forEach(x => x.onclick = () => {
    mode = x.dataset.v; $$('#modeSeg button', b).forEach(y => y.classList.toggle('on', y === x));
    $('#ofText', b).hidden = mode !== 'text'; $('#ofSold', b).hidden = mode !== 'sold';
    $('#ofGo', b).textContent = mode === 'sold' ? 'Record the sale' : mode === 'text' ? 'Send text + open lead' : 'Note it + open lead';
  });
  $('#ofGo', b).onclick = async () => {
    const btn = $('#ofGo', b); btn.disabled = true; setMsg('#ofMsg', 'Working…');
    const phone = $('#ofPhone', b).value.trim();
    const body = { mode, mover: S.me.name, note: $('#ofNote', b).value.trim(), text: $('#ofBody', b).value.trim(),
      amount: mode === 'sold' ? (+$('#ofAmt', b).value || 0) * (+$('#ofQty', b).value || 1) : 0, qty: +$('#ofQty', b).value || 1, payment: $('#ofPay', b).value,
      move: { id: m.id, customer: m.customer, phone, piano: m.piano, type: m.type, date: m.date, eventId: m.eventId },
      service: { id: u.id, name: u.s, kind: u.kind, price: u.price || 0, bonus: u.bonus, url: u.url || '', image: u.image || '' } };
    if (mode === 'text' && !phone) { setMsg('#ofMsg', 'Add a phone number to text.', 'err'); btn.disabled = false; return; }
    try {
      let j = { ok: true, offline: true };
      try { j = await api('/api/offer', body); } catch (e) { j = { ok: true, offline: true }; }
      if (!j.ok) throw new Error(j.error || 'could not file the offer');
      if (CFG.moversBridgeUrl) bridgePost(CFG.moversBridgeUrl, { key: KEY(), action: 'upsell', who: S.me.name, move: body.move, lead: { service: u.s, interest: mode === 'sold' ? 'Sold on site' : mode === 'text' ? 'Texted offer' : 'Maybe', note: body.note, mode, amount: body.amount, payment: body.payment, leadId: j.leadId || '', bonus: u.bonus } }).catch(() => {});
      if (mode === 'text' && !(j.sms && j.sms.sent)) { location.href = smsUrl(phone, body.text); }
      const lead = j.leadId ? (j.leadStatus === 'existing' ? 'noted on their existing Sales App lead' : 'lead ' + j.leadId + ' opened in the Sales App') : (j.offline ? 'lead opens once the site is live' : 'Sales App not reachable — the office was noted');
      toast(mode === 'sold' ? `Sale recorded · bonus ${money(u.bonus)} earned` : mode === 'text' ? 'Offer texted · ' + lead : 'Noted · ' + lead);
      closeSheet(); bonusCache = null; bonusStrip();
    } catch (e) { setMsg('#ofMsg', '✗ ' + e.message, 'err'); btn.disabled = false; }
  };
}
/* ===================== WEEK / HISTORY / CHECKLIST / CLOCK / MORE ===================== */
function viewSwitch(on) {
  return `<div class="vswitch">${[['day', 'Day', '#today'], ['week', 'Week', '#week'], ['month', 'Month', '#month']].map(([k, l, h]) => `<a href="${h}" class="${on === k ? 'on' : ''}">${l}</a>`).join('')}${on !== 'day' ? `<button type="button" class="vtoday" id="vToday">Today</button>` : ''}</div>`;
}
function weekStart(d) { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() - x.getDay()); return x.toLocaleDateString('en-CA'); }
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const H0 = 7, H1 = 20, HPX = 44;   // 7 AM – 8 PM, 44px per hour
function mins(t) { const [h, m] = t.split(':').map(Number); return h * 60 + m; }
function evBlock(m, showTime) {
  const top = Math.max(0, (mins(m.time) - H0 * 60) / 60 * HPX);
  const dur = m.end ? Math.max(30, mins(m.end) - mins(m.time)) : 90;
  const h = Math.max(22, dur / 60 * HPX - 2);
  const last = m.customer.split(/\s+/).pop();
  return `<a class="ev ${m.done ? 'done' : ''} ${m.stairs.warn ? 'flight' : ''}" href="#details/${encodeURIComponent(m.id)}" style="top:${top}px;height:${h}px" title="${esc(m.time + ' ' + m.customer + ' · ' + m.piano)}">
    ${showTime ? `<b>${esc(m.time)}</b> ` : ''}${esc(last)}${m.stairs.warn ? ' <i>▲</i>' : ''}</a>`;
}
async function renderWeek() {
  const main = $('#main');
  const ws = weekStart(S.day), we = addDays(ws, 6);
  main.innerHTML = `<div class="page"><div class="dayhead"><div><h1>${esc(fmtShort(ws))} – ${esc(fmtShort(we))}</h1><div class="sub">Loading the week…</div></div></div>${viewSwitch('week')}</div>`;
  let moves = [];
  try { moves = await fetchRange(ws, we); } catch (e) { main.querySelector('.sub').textContent = 'Could not load: ' + e.message; return; }
  const days = []; for (let i = 0; i < 7; i++) days.push(addDays(ws, i));
  const byDay = {}; moves.forEach(m => (byDay[m.date] = byDay[m.date] || []).push(m));
  const flights = moves.filter(m => m.stairs.warn && !m.done).length;
  const t = today();
  main.innerHTML = `<div class="page">
    <div class="dayhead"><div><h1>${esc(fmtShort(ws))} – ${esc(fmtShort(we))}</h1><div class="sub">${moves.length} move${moves.length === 1 ? '' : 's'} this week${flights ? ' · ' + flights + ' with a flight of stairs' : ''}</div></div>
      <div class="daynav"><button id="wPrev" aria-label="Previous week"><span>‹</span></button><button id="wNext" aria-label="Next week"><span>›</span></button></div></div>
    ${viewSwitch('week')}
    <div class="cal week">
      <div class="whead"><div class="gut"></div>${days.map(d => `<a href="#today" data-day="${d}" class="wday ${d === t ? 'today' : ''}"><small>${DOW[new Date(d + 'T12:00:00').getDay()]}</small><b>${+d.slice(8)}</b></a>`).join('')}</div>
      <div class="allday"><div class="gut">all day</div>${days.map(d => `<div class="adcell">${(byDay[d] || []).filter(m => !m.time).map(m => `<a class="ev ad ${m.done ? 'done' : ''}" href="#details/${encodeURIComponent(m.id)}">${esc(m.customer.split(/\s+/).pop())}</a>`).join('')}</div>`).join('')}</div>
      <div class="wgrid" style="height:${(H1 - H0) * HPX}px">
        <div class="gut">${Array.from({ length: H1 - H0 }, (_, i) => `<div class="hr" style="top:${i * HPX}px">${((H0 + i + 11) % 12) + 1}${H0 + i < 12 ? 'a' : 'p'}</div>`).join('')}</div>
        ${days.map(d => `<div class="wcol ${d === t ? 'today' : ''}" data-day="${d}">${Array.from({ length: H1 - H0 }, (_, i) => `<div class="hline" style="top:${i * HPX}px"></div>`).join('')}${(byDay[d] || []).filter(m => m.time).map(m => evBlock(m, false)).join('')}</div>`).join('')}
      </div>
    </div>
    <div class="lite">Tap a day number for that day's board, or a move to open it. ▲ marks a flight of stairs.</div>
  </div>`;
  $('#wPrev').onclick = () => { S.day = addDays(ws, -7); renderWeek(); };
  $('#wNext').onclick = () => { S.day = addDays(ws, 7); renderWeek(); };
  $('#vToday').onclick = () => { S.day = today(); renderWeek(); };
  $$('[data-day]', main).forEach(el => { if (el.tagName === 'A') el.onclick = () => { S.day = el.dataset.day; }; else el.onclick = ev => { if (ev.target === el || ev.target.classList.contains('hline')) { S.day = el.dataset.day; location.hash = '#today'; } }; });
  if (days.includes(t)) { const now = nowHHMM(); const y = (mins(now) - H0 * 60) / 60 * HPX; if (y > 0 && y < (H1 - H0) * HPX) $('.wcol.today', main).insertAdjacentHTML('beforeend', `<div class="nowline" style="top:${y}px"></div>`); }
}
async function renderMonth() {
  const main = $('#main');
  const first = S.day.slice(0, 8) + '01';
  const fd = new Date(first + 'T12:00:00');
  const gridStart = weekStart(first);
  const lastDay = new Date(fd.getFullYear(), fd.getMonth() + 1, 0).getDate();
  const last = S.day.slice(0, 8) + String(lastDay).padStart(2, '0');
  const gridEnd = addDays(weekStart(last), 6);
  const title = fd.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  main.innerHTML = `<div class="page"><div class="dayhead"><div><h1>${esc(title)}</h1><div class="sub">Loading the month…</div></div></div>${viewSwitch('month')}</div>`;
  let moves = [];
  try { moves = await fetchRange(gridStart, gridEnd); } catch (e) { main.querySelector('.sub').textContent = 'Could not load: ' + e.message; return; }
  const byDay = {}; moves.forEach(m => (byDay[m.date] = byDay[m.date] || []).push(m));
  const inMonth = moves.filter(m => m.date >= first && m.date <= last);
  const t = today();
  const cells = []; for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) cells.push(d);
  main.innerHTML = `<div class="page">
    <div class="dayhead"><div><h1>${esc(title)}</h1><div class="sub">${inMonth.length} move${inMonth.length === 1 ? '' : 's'} · ${inMonth.filter(m => m.stairs.warn).length} with a flight of stairs</div></div>
      <div class="daynav"><button id="mPrev" aria-label="Previous month"><span>‹</span></button><button id="mNext" aria-label="Next month"><span>›</span></button></div></div>
    ${viewSwitch('month')}
    <div class="cal month">
      <div class="mhead">${DOW.map(d => `<div>${d[0]}</div>`).join('')}</div>
      <div class="mgrid">${cells.map(d => { const ms = (byDay[d] || []).sort((a, b) => (a.time || '99').localeCompare(b.time || '99')); const out = d < first || d > last; return `<div class="mcell ${out ? 'out' : ''} ${d === t ? 'today' : ''} ${ms.length ? 'has' : ''}" data-day="${d}">
        <b>${+d.slice(8)}</b>
        ${ms.slice(0, 3).map(m => `<span class="mev ${m.done ? 'done' : ''} ${m.stairs.warn ? 'flight' : ''}">${m.time ? esc(m.time.replace(/^0/, '')) + ' ' : ''}${esc(m.customer.split(/\s+/).pop())}</span>`).join('')}
        ${ms.length > 3 ? `<span class="mmore">+${ms.length - 3} more</span>` : ''}</div>`; }).join('')}</div>
    </div>
    <div class="lite">Tap a day to open its board. Red marks a flight of stairs.</div>
  </div>`;
  $('#mPrev').onclick = () => { S.day = addDays(first, -1).slice(0, 8) + '01'; renderMonth(); };
  $('#mNext').onclick = () => { S.day = addDays(last, 1); renderMonth(); };
  $('#vToday').onclick = () => { S.day = today(); renderMonth(); };
  $$('.mcell', main).forEach(c => c.onclick = () => { S.day = c.dataset.day; location.hash = '#today'; });
}
async function renderHistory() {
  const main = $('#main'); main.innerHTML = '<div class="empty">Loading…</div>';
  let rows = [];
  try { const j = await fetch('/api/log?key=' + encodeURIComponent(KEY()) + '&kind=report&who=' + encodeURIComponent(S.me.name)).then(r => r.json()); rows = j.rows || []; } catch (e) {}
  main.innerHTML = `<div class="page"><h1>My reports</h1>${rows.length ? rows.map(r => `<div class="card"><b class="serif" style="font-size:17px">${esc(r.customer)}</b><div class="lite">${esc(r.date)} · ${esc(r.stage)} · ${esc(r.piano)} · ${r.photos} photo${r.photos === 1 ? '' : 's'}${r.flags && r.flags.length ? ' · ' + r.flags.length + ' flagged' : ''}${r.signed ? ' · signed' : ''}</div>${r.folderUrl ? `<a href="${esc(r.folderUrl)}" target="_blank" rel="noopener">Drive folder</a>` : ''}</div>`).join('') : '<div class="empty">No reports filed yet.</div>'}</div>`;
}
const TRUCK = ['Skid board & grand straps', '4-wheel dolly + upright dolly', 'Ratchet straps (4)', 'Moving blankets (12)', 'Leg & lyre kit, screwdriver set, pedal bag', 'Stair climber / hand truck', 'Door-jamb guards', 'Floor runners', 'Drill, tape, gloves', 'Caster cups & bench covers to sell', 'Card reader + receipt book', 'Phones charged · fuel above ½'];
function renderChecklist() {
  const k = 'blpTruck:' + today();
  const done = new Set(ls.json(k) || []);
  $('#main').innerHTML = `<div class="page"><h1>Truck checklist</h1><p class="lite">Resets every morning. ${done.size}/${TRUCK.length} checked.</p>
    ${TRUCK.map((t, i) => `<label class="tick ${done.has(i) ? 'done' : ''}"><input type="checkbox" data-i="${i}" ${done.has(i) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</div>`;
  $$('.tick input').forEach(c => c.onchange = () => { c.checked ? done.add(+c.dataset.i) : done.delete(+c.dataset.i); ls.set(k, JSON.stringify([...done])); renderChecklist(); });
}
function renderClock() {
  const st = ls.json('blpClock') || {};
  $('#main').innerHTML = `<div class="page"><h1>Clock in / out</h1>
    <div class="card"><b class="serif" style="font-size:18px">Coming soon</b><p class="lite" style="margin-top:6px">Clock in and out will live here and feed the BLP Work Clock. Until then, keep using the Store Map's clock. This button only remembers your times on this phone.</p></div>
    <div class="btns"><button class="btn ${st.in && !st.out ? '' : 'primary'}" id="ckIn" ${st.in && !st.out ? 'disabled' : ''}>Clock in</button><button class="btn ${st.in && !st.out ? 'primary' : ''}" id="ckOut" ${st.in && !st.out ? '' : 'disabled'}>Clock out</button></div>
    <div class="lite">${st.in ? 'In: ' + esc(new Date(st.in).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })) : 'Not clocked in today'}${st.out ? ' · Out: ' + esc(new Date(st.out).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })) : ''}</div>
    <a class="btn wide sm" href="https://blpstoremap.netlify.app/" target="_blank" rel="noopener">Open the Store Map work clock</a></div>`;
  $('#ckIn').onclick = () => { ls.set('blpClock', JSON.stringify({ in: Date.now() })); api('/api/log', { kind: 'clock', who: S.me.name, data: { action: 'in' } }).catch(() => {}); renderClock(); };
  $('#ckOut').onclick = () => { ls.set('blpClock', JSON.stringify({ ...st, out: Date.now() })); api('/api/log', { kind: 'clock', who: S.me.name, data: { action: 'out' } }).catch(() => {}); renderClock(); };
}
function renderMore() {
  const ROAD = [
    ['✓', 'Daily move board from the pianomoving.blp calendar, stairs and bench at a glance'],
    ['✓', 'Navigate, route the whole day, call and copy address'],
    ['✓', 'Live ETA texts with the BLP truck on a map (Uber-style), plus late / arrived / thank-you texts'],
    ['✓', 'Condition report with photos, video, signature — filed to Drive + sheet + the calendar event'],
    ['✓', 'Change orders with customer signature; office texted instantly'],
    ['✓', 'Piano care & services: friendly offer texts, on-site sales, Sales App leads with the mover as source, bonus tally'],
    ['✓', 'Truck checklist; week and month calendars'],
    ['✓', '💡 suggestions go to the Store Map\'s App Requests list'],
    ['soon', 'Clock in / out wired to the BLP Work Clock (and mileage per move for job costing)'],
    ['✓', 'Google sign-in for BLP accounts, with the team password as the fallback'],
    ['soon', 'Office view: every truck live on one map, ETA drift alerts'],
    ['soon', 'Customer pre-arrival text the night before (clear the path, pets, parking)'],
    ['soon', 'Spanish toggle, like the Shop App'],
    ['soon', 'Piano Log link: pull make/model/serial straight from the log when the event has an SN'],
  ];
  $('#main').innerHTML = `<div class="page"><h1>More</h1>
    <div class="card"><div class="rowk"><b>Name</b><span>${esc(S.me.name)}</span><b>Signed in</b><span>${S.me.google ? 'Google · ' + esc(S.me.email) : 'team password'}</span><b>Calendar</b><span>${CFG.moversBridgeUrl ? 'Movers bridge connected' : 'example data (no bridge URL yet)'}</span><b>Texts</b><span>${S.cfg.smsConfigured ? 'Twilio ready' : 'phone Messages app (Twilio not set)'}</span><b>Map key</b><span>${S.cfg.mapsKey ? 'set' : 'not set — tracking page uses the simple view'}</span><b>Version</b><span>${VERSION}</span></div></div>
    <div class="btns"><button class="btn" id="moreBulb">💡 Suggest an improvement</button><a class="btn" href="https://blpstoremap.netlify.app/" target="_blank" rel="noopener">🚀 App Updates (Store Map)</a></div>
    <h2>What this app does <small>and what is next</small></h2>
    <div class="road">${ROAD.map(([s, t]) => `<div><i class="${s === 'soon' ? 'soon' : ''}">${s === 'soon' ? '○' : '✓'}</i><span>${esc(t)}</span></div>`).join('')}</div>
  </div>`;
  $('#moreBulb').onclick = suggestBox;
}

/* ===================== 💡 SUGGEST (Store Map bridge) ===================== */
function suggestBox() {
  const device = (window.innerWidth <= 760 || /iphone|android.*mobile|ipad/i.test(navigator.userAgent)) ? 'phone' : 'computer';
  let type = 'idea', shot = null;
  const b = sheet(`<h3>💡 Suggest an improvement</h3><div class="lite">Bugs, edits, ideas for BLP Movers — goes straight onto the BLP fix list (Store Map → App Requests).</div>
    <div class="sgtypes seg"><button type="button" data-t="idea" class="on">💡 Idea</button><button type="button" data-t="edit">✏️ Edit</button><button type="button" data-t="bug">🐛 Bug</button></div>
    <label class="fld">What would make it better?<textarea id="sgText" maxlength="1500" placeholder="A sentence or two is plenty."></textarea></label>
    <label class="addshot" style="aspect-ratio:auto;padding:12px"><span style="font-size:16px">📷 Attach a screenshot (optional)</span><input type="file" accept="image/*" id="sgShot"></label>
    <div class="lite" id="sgShotName"></div>
    <button class="btn eta wide" id="sgSend">Send it 🚀</button><div class="msg" id="sgMsg"></div>
    <div class="myreq" id="sgMine"><div class="lite">loading my requests…</div></div>`);
  $$('.sgtypes button', b).forEach(x => x.onclick = () => { $$('.sgtypes button', b).forEach(y => y.classList.remove('on')); x.classList.add('on'); type = x.dataset.t; });
  $('#sgShot', b).onchange = e => { shot = e.target.files[0] || null; $('#sgShotName', b).textContent = shot ? shot.name : ''; };
  $('#sgSend', b).onclick = async () => {
    const text = $('#sgText', b).value.trim();
    if (!text) return setMsg('#sgMsg', 'Write a sentence first.', 'err');
    const btn = $('#sgSend', b); btn.disabled = true; setMsg('#sgMsg', 'Sending…');
    const body = { pin: KEY(), action: 'suggest', type, text, app: 'BLP Movers', agent: '',
      context: 'BLP Movers · view:' + (location.hash || '#today') + ' · app: BLP Movers' + (device === 'phone' ? ' · 📱 phone' : ' · 💻 computer') + ' · v' + VERSION,
      user: { name: S.me.name, email: '' } };
    try {
      if (shot) {
        try {
          const dataUrl = await downscale(shot, 1600, 0.85);
          const up = await fetch('https://blpsalesapp.netlify.app/.netlify/functions/request-shot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: KEY(), id: Date.now().toString(36), photo: dataUrl.split(',')[1], photoType: 'image/jpeg', photoName: shot.name.replace(/[^\w.-]+/g, '_').slice(0, 40) }) });
          const uj = await up.json().catch(() => ({}));
          if (uj && uj.url) body.screenshotUrl = uj.url;
        } catch (e) { /* filed without the picture */ }
      }
      const j = await bridgePost(CFG.storeMapBridgeUrl, body);
      if (!j.ok || !j.id) throw new Error(j.error || 'the Google bridge hiccuped — try again in a few seconds');
      setMsg('#sgMsg', '✓ Filed as ' + j.id + ' — thank you! You\'ll see it move to Live here when it ships.', 'ok');
      $('#sgText', b).value = ''; shot = null; $('#sgShotName', b).textContent = '';
      loadMine(b);
    } catch (e) { setMsg('#sgMsg', '✗ ' + e.message, 'err'); }
    btn.disabled = false;
  };
  loadMine(b);
}
async function loadMine(b) {
  const box = $('#sgMine', b);
  try {
    const j = await bridgeGet(CFG.storeMapBridgeUrl + '?fn=requests');
    const me = S.me.name.toLowerCase();
    const mine = (j.requests || []).filter(x => (x.who || '').toLowerCase() === me).slice(0, 10);
    box.innerHTML = mine.length ? '<b>My requests</b>' + mine.map(x => `<div><span class="st s${esc(String(x.status || '').replace(/\s/g, ''))}">${esc(x.status)}</span><span>${esc(String(x.text).slice(0, 140))}</span></div>`).join('') : '<div class="lite">No requests from you yet — be the first!</div>';
  } catch (e) { box.innerHTML = ''; }
}

/* ===================== boot ===================== */
$('#suggestBtn').onclick = suggestBox;
$('#menuBtn').onclick = () => openDrawer(!$('#drawer').classList.contains('open'));
$('#scrim').onclick = () => openDrawer(false);
$$('#drawer a[href^="#"]').forEach(a => a.onclick = () => openDrawer(false));
$('#logoHome').onclick = () => { S.day = today(); location.hash = '#today'; route(); };
$('#refreshBtn').onclick = async () => { $('#refreshBtn').textContent = '…'; await loadMoves(S.day); $('#refreshBtn').textContent = '↻'; route(); toast('Moves refreshed'); };
$('#verTag').textContent = 'v' + VERSION;
(async () => {
  consumeOidcHash();
  if (!loadMe()) return;
  fetch('/api/config').then(r => r.json()).then(c => { S.cfg = c || {}; }).catch(() => {});
  if (S.share) startSharing(S.share);
  await loadMoves(S.day, true);
  route();
  // refresh the board every 3 minutes so calendar edits from the office show up
  setInterval(() => { if ((location.hash || '#today') === '#today' && !document.hidden) loadMoves(S.day, true).then(() => { if ((location.hash || '#today') === '#today') renderToday(); }); }, 180000);
})();
})();
