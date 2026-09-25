/* ===================== BLP MOVERS BRIDGE =====================
 * Google Apps Script web app behind the BLP Movers app.
 *   Deploy: script.google.com → New project → paste this file → Deploy →
 *   New deployment → Web app → Execute as: Me · Who has access: Anyone.
 *   Paste the /exec URL into config.js (moversBridgeUrl).
 *
 * Runs as the deploying Google account, which must be able to see the
 * pianomoving.blp@gmail.com calendar (share it with that account, or
 * deploy from pianomoving.blp itself) and write to the Drive folder below.
 *
 * Script Properties (File → Project properties → Script properties):
 *   MOVERS_KEY        team key for writes (default 'pianoman', same as the apps)
 *   MOVING_CAL_ID     calendar id (default 'pianomoving.blp@gmail.com')
 *   DRIVE_ROOT_ID     folder id where move folders are created
 *                     (default: a "BLP Moves" folder created in My Drive)
 *   LOG_SHEET_ID      spreadsheet for Condition Reports / Change Orders /
 *                     Service Interest tabs (default: "BLP Movers Log" created)
 *   OFFICE_NAMES      comma list of teammates to text on change orders,
 *                     e.g. "Melissa,Karmel" (texts go through the Sales App's
 *                     request-notify, same as the Store Map bridge)
 *
 * GET  ?fn=ping
 * GET  ?fn=moves&from=YYYY-MM-DD&to=YYYY-MM-DD   full events (title, location,
 *                                                description, times, id)
 * POST (text/plain JSON) {key, action, ...}
 *   report        condition report: creates the move's Drive folder, saves
 *                 photos (base64), writes report.json + summary, appends the
 *                 Condition Reports row, links the folder on the calendar event
 *   videosession  resumable Drive upload for a large video: returns
 *                 {sessionUrl}; the browser PUTs the file straight to Google
 *   changeorder   appends a Change Orders row + texts the office
 *   upsell        appends a Service Interest row (care & services the customer wanted)
 *   markdone      prefixes the calendar event title with "x " (Store Map's
 *                 done convention) and notes who/when in the description
 */
var BRIDGE_REV = '2026-09-25.1';

function prop_(k, d) { var v = PropertiesService.getScriptProperties().getProperty(k); return v == null || v === '' ? d : v; }
function key_() { return prop_('MOVERS_KEY', 'pianoman'); }
function tz_() { return 'America/Denver'; }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doGet(e) {
  var fn = (e && e.parameter && e.parameter.fn) || 'ping';
  try {
    if (fn === 'moves') return json_(moves_(e.parameter.from, e.parameter.to));
    return json_({ ok: true, service: 'BLP Movers bridge', rev: BRIDGE_REV, enc: '→ — 🎹' });
  } catch (err) { return json_({ error: String(err) }); }
}

function doPost(e) {
  var req = {};
  try { req = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (x) { return json_({ error: 'bad json' }); }
  if (String(req.key || '') !== key_()) return json_({ error: 'unauthorized' });
  try {
    switch (req.action) {
      case 'report': return json_(saveReport_(req));
      case 'videosession': return json_(videoSession_(req));
      case 'changeorder': return json_(changeOrder_(req));
      case 'upsell': return json_(upsell_(req));
      case 'markdone': return json_(markDone_(req));
      default: return json_({ error: 'unknown action' });
    }
  } catch (err) { return json_({ error: String(err).slice(0, 300) }); }
}

/* ---------- calendar ---------- */
function cal_() {
  var id = prop_('MOVING_CAL_ID', 'pianomoving.blp@gmail.com');
  var c = CalendarApp.getCalendarById(id);
  if (!c) { try { c = CalendarApp.subscribeToCalendar(id); } catch (x) {} }
  if (!c) throw new Error('moving calendar not visible to ' + Session.getEffectiveUser().getEmail());
  return c;
}
function day_(d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }
function moves_(from, to) {
  var f = from ? new Date(from + 'T00:00:00') : new Date();
  var t = to ? new Date(to + 'T23:59:59') : new Date(f.getTime() + 86400000);
  if (t - f > 62 * 86400000) throw new Error('range too long');
  var evs = cal_().getEvents(f, t).slice(0, 300).map(function (ev) {
    var allDay = ev.isAllDayEvent();
    return {
      id: ev.getId(), date: day_(ev.getStartTime()),
      time: allDay ? null : Utilities.formatDate(ev.getStartTime(), tz_(), 'HH:mm'),
      end: allDay ? null : Utilities.formatDate(ev.getEndTime(), tz_(), 'HH:mm'),
      title: ev.getTitle(), location: String(ev.getLocation() || ''),
      description: String(ev.getDescription() || '').slice(0, 4000),
      color: ev.getColor() || '',
    };
  });
  return { ok: true, events: evs, rev: BRIDGE_REV };
}
function findEvent_(id) {
  if (!id) return null;
  try { var ev = cal_().getEventById(id); if (ev) return ev; } catch (x) {}
  return null;
}
function markDone_(req) {
  var ev = findEvent_(req.eventId);
  if (!ev) return { error: 'event not found' };
  var t = ev.getTitle();
  if (!/^\s*x\s+/i.test(t)) ev.setTitle('x ' + t);
  var stamp = Utilities.formatDate(new Date(), tz_(), 'M/d h:mm a');
  ev.setDescription((ev.getDescription() || '') + '\n\n✅ ' + (req.what || 'Done') + ' — ' + (req.who || 'mover') + ' ' + stamp);
  return { ok: true };
}

/* ---------- drive + sheet ---------- */
function root_() {
  var id = prop_('DRIVE_ROOT_ID', '');
  if (id) return DriveApp.getFolderById(id);
  var it = DriveApp.getFoldersByName('BLP Moves');
  var f = it.hasNext() ? it.next() : DriveApp.createFolder('BLP Moves');
  PropertiesService.getScriptProperties().setProperty('DRIVE_ROOT_ID', f.getId());
  return f;
}
function sub_(parent, name) {
  var it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}
function safe_(s) { return String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80); }
function moveFolder_(req) {
  var m = req.move || {};
  var day = m.date || day_(new Date());
  var year = day.slice(0, 4);
  var name = day + ' — ' + safe_(m.customer || 'Customer') + (m.piano ? ' — ' + safe_(m.piano) : '');
  return sub_(sub_(root_(), year), name);
}
function sheet_(tab, header) {
  var id = prop_('LOG_SHEET_ID', '');
  var ss = id ? SpreadsheetApp.openById(id) : null;
  if (!ss) {
    ss = SpreadsheetApp.create('BLP Movers Log');
    PropertiesService.getScriptProperties().setProperty('LOG_SHEET_ID', ss.getId());
  }
  var sh = ss.getSheetByName(tab);
  if (!sh) { sh = ss.insertSheet(tab); sh.getRange(1, 1, 1, header.length).setValues([header]); sh.setFrozenRows(1); }
  return sh;
}
function moveInfoText_(m, who) {
  return ['BRIGHAM LARSON PIANOS — MOVE', '',
    'Customer: ' + (m.customer || ''), 'Phone: ' + (m.phone || ''), 'Date: ' + (m.date || '') + ' ' + (m.time || ''),
    'Piano: ' + (m.piano || ''), 'From: ' + (m.from || ''), 'To: ' + (m.to || ''),
    'Stairs: ' + (m.stairsText || ''), 'Bench: ' + (m.bench || ''), 'Crew: ' + (m.crew || ''), 'Filed by: ' + (who || ''),
    '', 'CALENDAR EVENT', (m.title || ''), (m.location || ''), '', (m.description || '')].join('\n');
}
function saveReport_(req) {
  var who = String(req.who || 'mover');
  var m = req.move || {};
  var folder = moveFolder_(req);
  var stage = String(req.stage || 'pickup');
  // calendar details travel with the media
  var info = folder.getFilesByName('move-details.txt');
  if (!info.hasNext()) folder.createFile('move-details.txt', moveInfoText_(m, who), MimeType.PLAIN_TEXT);
  var saved = [];
  var shots = req.photos || [];
  for (var i = 0; i < shots.length; i++) {
    var p = shots[i];
    if (!p || !p.data) continue;
    var mime = p.mime || 'image/jpeg';
    var ext = mime.indexOf('png') >= 0 ? 'png' : mime.indexOf('mp4') >= 0 ? 'mp4' : mime.indexOf('quicktime') >= 0 ? 'mov' : mime.indexOf('webm') >= 0 ? 'webm' : 'jpg';
    var name = stage + '-' + (p.tag || 'photo') + '-' + ('0' + (i + 1)).slice(-2) + '.' + ext;
    var blob = Utilities.newBlob(Utilities.base64Decode(p.data), mime, name);
    var f = folder.createFile(blob);
    saved.push({ name: name, url: f.getUrl(), id: f.getId() });
  }
  var stamp = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH.mm');
  var r = req.report || {};
  folder.createFile('condition-report-' + stage + '-' + stamp + '.json', JSON.stringify({ move: m, report: r, who: who, stage: stage, photos: saved, at: new Date().toISOString() }, null, 2), MimeType.PLAIN_TEXT);
  folder.createFile('condition-report-' + stage + '-' + stamp + '.txt', reportText_(m, r, who, stage, saved), MimeType.PLAIN_TEXT);
  if (r.signature) {
    try { folder.createFile(Utilities.newBlob(Utilities.base64Decode(r.signature), 'image/png', 'signature-' + stage + '-' + stamp + '.png')); } catch (x) {}
  }
  var sh = sheet_('Condition Reports', ['At', 'Date', 'Customer', 'Phone', 'Piano', 'Stage', 'Bench', 'Stairs (actual)', 'Flagged items', 'Notes', 'Photos', 'Folder', 'Filed by', 'Customer signed', 'Event']);
  sh.appendRow([new Date().toISOString(), m.date || '', m.customer || '', m.phone || '', m.piano || '', stage,
    r.bench || '', r.stairsActual || '', (r.flags || []).join('; '), r.notes || '', saved.length, folder.getUrl(), who,
    r.customerName ? r.customerName + (r.signature ? ' (signed)' : '') : '', m.eventId || '']);
  var ev = findEvent_(m.eventId);
  if (ev) {
    var d = ev.getDescription() || '';
    if (d.indexOf(folder.getUrl()) < 0) ev.setDescription(d + '\n\n📸 ' + stage + ' condition report by ' + who + ': ' + folder.getUrl());
  }
  return { ok: true, folderUrl: folder.getUrl(), folderId: folder.getId(), photos: saved };
}
function reportText_(m, r, who, stage, saved) {
  var L = ['BRIGHAM LARSON PIANOS — PIANO TRANSPORTATION CONDITION REPORT', 'Stage: ' + stage.toUpperCase(), 'Filed by: ' + who + '  ' + Utilities.formatDate(new Date(), tz_(), 'M/d/yyyy h:mm a'), '',
    'Customer: ' + (m.customer || '') + '   Phone: ' + (m.phone || ''), 'From: ' + (m.from || ''), 'To: ' + (m.to || ''), '',
    'PIANO', 'Type: ' + (r.type || '') + '   Make: ' + (r.make || '') + '   Model: ' + (r.model || '') + '   Serial: ' + (r.serial || ''), 'Finish: ' + (r.finish || ''),
    'Bench: ' + (r.bench || '') + (r.benchType ? ' (' + r.benchType + ')' : '') + (r.benchNote ? ' — ' + r.benchNote : ''),
    'Accessories: ' + ((r.accessories || []).join(', ') || 'none'), '',
    'SITE', 'Stairs booked: ' + (m.stairsText || 'n/a') + '   Stairs actual: ' + (r.stairsActual || '') , 'Path / access: ' + (r.access || ''), '', 'CONDITION'];
  var c = r.condition || {};
  Object.keys(c).forEach(function (k) { var v = c[k]; L.push('  ' + k + ': ' + (v.state || 'Good') + (v.note ? ' — ' + v.note : '')); });
  var fn = r.functional || {};
  L.push('', 'FUNCTION');
  Object.keys(fn).forEach(function (k) { L.push('  ' + k + ': ' + fn[k]); });
  L.push('', 'Notes: ' + (r.notes || ''), '', 'Photos/videos: ' + saved.length);
  saved.forEach(function (s) { L.push('  ' + s.name + '  ' + s.url); });
  L.push('', 'Customer: ' + (r.customerName || '') + (r.signature ? '  [signature on file]' : '') + (r.ack ? '  Acknowledged pre-existing condition' : ''));
  return L.join('\n');
}
// Large videos: open a Drive resumable session; the phone uploads the bytes
// directly to Google (no 50 MB Apps Script payload limit).
function videoSession_(req) {
  var folder = moveFolder_(req);
  var meta = { name: safe_(req.name || 'video.mp4'), parents: [folder.getId()] };
  var res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
    method: 'post', contentType: 'application/json; charset=UTF-8', payload: JSON.stringify(meta),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Upload-Content-Type': req.mime || 'video/mp4', Origin: req.origin || 'https://blpmovers.netlify.app' },
    muteHttpExceptions: true,
  });
  var loc = res.getAllHeaders()['Location'] || res.getAllHeaders()['location'];
  if (!loc) return { error: 'no session: ' + res.getContentText().slice(0, 200) };
  return { ok: true, sessionUrl: loc, folderUrl: folder.getUrl() };
}

/* ---------- change orders + upsell ---------- */
function changeOrder_(req) {
  var m = req.move || {}, co = req.order || {};
  var sh = sheet_('Change Orders', ['At', 'Date', 'Customer', 'Phone', 'Piano', 'Items', 'Added total', 'Reason', 'Customer agreed', 'Filed by', 'Event']);
  var items = (co.items || []).map(function (i) { return i.label + (i.qty > 1 ? ' ×' + i.qty : '') + ' $' + i.amount; }).join('; ');
  sh.appendRow([new Date().toISOString(), m.date || '', m.customer || '', m.phone || '', m.piano || '', items, co.total || 0, co.reason || '', co.agreed ? co.customerName || 'yes' : 'not yet', req.who || '', m.eventId || '']);
  var ev = findEvent_(m.eventId);
  if (ev) ev.setDescription((ev.getDescription() || '') + '\n\n💲 Change order by ' + (req.who || 'mover') + ': +$' + (co.total || 0) + ' — ' + items + (co.reason ? ' (' + co.reason + ')' : ''));
  var texted = notifyOffice_('💲 Change order — ' + (m.customer || 'customer') + ' (' + (m.piano || 'piano') + '): +$' + (co.total || 0) + '. ' + items + (co.reason ? '. ' + co.reason : '') + ' — ' + (req.who || 'mover'));
  return { ok: true, texted: texted };
}
function upsell_(req) {
  var m = req.move || {}, u = req.lead || {};
  var sh = sheet_('Service Interest', ['At', 'Date', 'Customer', 'Phone', 'Piano', 'Service', 'Interest', 'Note', 'Mover', 'Event', 'Mode', 'Amount', 'Payment', 'Sales App lead', 'Mover bonus']);
  sh.appendRow([new Date().toISOString(), m.date || '', m.customer || '', m.phone || '', m.piano || '', u.service || '', u.interest || '', u.note || '', req.who || '', m.eventId || '',
    u.mode || '', u.amount || '', u.payment || '', u.leadId || '', u.bonus || '']);
  if (u.interest === 'Sold on site' || u.interest === 'Yes — book it') notifyOffice_('✦ Service interest YES — ' + (m.customer || 'customer') + ' wants ' + (u.service || 'a service') + '. ' + (u.note || '') + ' — ' + (req.who || 'mover') + (m.phone ? ' · ' + m.phone : ''));
  return { ok: true };
}
// Texts teammates by first name through the Sales App's request-notify —
// the same path the Store Map bridge's notifyTeam_ uses.
function notifyOffice_(msg) {
  var names = prop_('OFFICE_NAMES', '').split(',').map(function (s) { return s.trim(); }).filter(String);
  var n = 0;
  names.forEach(function (name) {
    try {
      UrlFetchApp.fetch('https://blpsalesapp.netlify.app/.netlify/functions/request-notify', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true,
        payload: JSON.stringify({ key: key_(), name: name, message: msg.slice(0, 1200), now: true }),
      });
      n++;
    } catch (x) {}
  });
  return n;
}
