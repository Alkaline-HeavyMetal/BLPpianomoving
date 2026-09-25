// /api/sm — server-side proxy to the Store Map's Apps Script bridge, so the
// phone never talks to script.google.com directly (some networks and
// in-app browsers stall on Google's redirect dance). GET passes the query
// through (?fn=payroll…); POST passes the JSON body through unchanged.
import { json, readJson, CORS } from './_lib.mjs';
const BRIDGE = process.env.STOREMAP_BRIDGE_URL || 'https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec';
export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    if (req.method === 'GET') {
      const q = new URL(req.url).search;
      const r = await fetch(BRIDGE + q, { redirect: 'follow' });
      const t = await r.text();
      try { return json(JSON.parse(t)); } catch { return json({ error: 'bridge returned non-JSON: ' + t.slice(0, 120) }, { status: 502 }); }
    }
    const body = await readJson(req);
    const r = await fetch(BRIDGE, { method: 'POST', redirect: 'follow', headers: { 'content-type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body) });
    const t = await r.text();
    try { return json(JSON.parse(t)); } catch { return json({ error: 'bridge returned non-JSON: ' + t.slice(0, 120) }, { status: 502 }); }
  } catch (e) { return json({ error: String(e) }, { status: 502 }); }
};
