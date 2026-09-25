// Shared helpers for the BLP Movers Netlify functions.
import { getStore } from '@netlify/blobs';

export const KEY = process.env.BLP_APP_ACCESS_KEY || 'pianoman';
export const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'content-type',
  'access-control-allow-methods': 'GET,POST,OPTIONS',
};
export const json = (body, init = {}) =>
  Response.json(body, { ...init, headers: { ...CORS, ...(init.headers || {}) } });

export const store = () => getStore({ name: 'movers', consistency: 'strong' });

export async function readJson(req) {
  try { return await req.json(); } catch { return {}; }
}
export function keyOk(body, url) {
  const k = (body && body.key) || (url && new URL(url).searchParams.get('key')) || '';
  return k === KEY;
}
export const token = (n = 10) => {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  for (const b of bytes) s += a[b % a.length];
  return s;
};
export function e164(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return '';
}
// Twilio REST — same env vars as the Sales App (TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN, TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM).
export async function sendSms(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID, tok = process.env.TWILIO_AUTH_TOKEN;
  const svc = process.env.TWILIO_MESSAGING_SERVICE_SID, from = process.env.TWILIO_FROM;
  if (!sid || !tok || !(svc || from)) return { sent: false, reason: 'twilio not configured' };
  const form = new URLSearchParams({ To: to, Body: body });
  if (svc) form.set('MessagingServiceSid', svc); else form.set('From', from);
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + btoa(sid + ':' + tok), 'content-type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { sent: false, reason: j.message || ('twilio ' + r.status) };
  return { sent: true, sid: j.sid };
}
export function haversineMi(a, b) {
  if (!a || !b) return null;
  const R = 3958.8, toR = x => x * Math.PI / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
