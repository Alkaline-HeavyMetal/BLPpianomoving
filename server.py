#!/usr/bin/env python3
"""Local dev server for BLP Movers: serves the static app and mirrors the
Netlify functions well enough to try everything without Netlify.
  /api/sm       -> proxied to the Store Map bridge (real clocks, real punches)
  /api/config   -> {} (no Maps key / Twilio locally)
  /api/log, /api/offer, /api/schedule, /api/eta, /api/location, /api/track
                -> stored in .dev-data.json next to this file
Run: python3 server.py  (port 8642)"""
import json, os, sys, time, random, string, urllib.request, urllib.parse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, '.dev-data.json')
BRIDGE = 'https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec'
KEY = 'pianoman'

def load():
    try: return json.load(open(DATA))
    except Exception: return {'log': [], 'offer': [], 'schedule': {}, 'track': {}}
def save(d): json.dump(d, open(DATA, 'w'), indent=1)
def tok(n=10): return ''.join(random.choice('abcdefghjkmnpqrstuvwxyz23456789') for _ in range(n))

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
    def send_json(self, obj, code=200):
        b = json.dumps(obj).encode()
        self.send_response(code); self.send_header('content-type', 'application/json'); self.send_header('access-control-allow-origin', '*')
        self.send_header('content-length', str(len(b))); self.end_headers(); self.wfile.write(b)
    def body(self):
        n = int(self.headers.get('content-length') or 0)
        try: return json.loads(self.rfile.read(n) or b'{}')
        except Exception: return {}
    def do_GET(self):
        u = urllib.parse.urlparse(self.path); q = urllib.parse.parse_qs(u.query)
        if u.path.startswith('/t/'): self.path = '/track.html'; return super().do_GET()
        if u.path == '/api/sm':
            try:
                with urllib.request.urlopen(urllib.request.Request(BRIDGE + '?' + u.query, headers={'User-Agent': 'blp-movers-dev'}), timeout=40) as r: t = r.read().decode()
                return self.send_json(json.loads(t))
            except Exception as e: return self.send_json({'error': str(e)}, 502)
        if u.path == '/api/pianolog':
            want = [x.strip().upper() for x in q.get('serials', [''])[0].split(',') if x.strip()]
            try:
                with urllib.request.urlopen('https://blpstoremap.netlify.app/api/data?scope=active', timeout=40) as r: pianos = json.loads(r.read().decode()).get('pianos', [])
                keys = ('serial','year','make','model','size','type','summary','location','status','phase','bench','benchNote','importantNote')
                found = {str(p.get('serial','')).strip().upper(): {k: p.get(k, '') for k in keys} | {'folder': p.get('mainFolder', '')} for p in pianos if p.get('serial') and str(p['serial']).strip().upper() in want}
                return self.send_json({'ok': True, 'found': found})
            except Exception as e: return self.send_json({'error': str(e)}, 502)
        if u.path == '/api/config': return self.send_json({'mapsKey': '', 'smsConfigured': False, 'site': 'http://localhost:8642', 'dev': True})
        d = load()
        if u.path == '/api/log':
            kind = q.get('kind', ['report'])[0]; who = q.get('who', [''])[0].lower()
            return self.send_json({'ok': True, 'rows': [r for r in reversed(d['log']) if r['kind'] == kind and (not who or r.get('who', '').lower() == who)][:100]})
        if u.path == '/api/offer':
            who = q.get('who', [''])[0].lower()
            rows = [r for r in reversed(d['offer']) if not who or r.get('mover', '').lower() == who]
            won = [r for r in rows if r['status'] == 'won']; op = [r for r in rows if r['status'] == 'open']
            return self.send_json({'ok': True, 'earned': sum(r['bonus'] for r in won), 'pending': sum(r['bonus'] for r in op), 'open': len(op), 'rows': rows[:50]})
        if u.path == '/api/schedule':
            rec = d['schedule'].get(q.get('who', [''])[0].lower())
            return self.send_json({'ok': True, 'schedule': rec and rec['schedule'], 'updatedAt': rec and rec['updatedAt']})
        if u.path == '/api/fleet':
            if q.get('key', [''])[0] != KEY: return self.send_json({'error': 'unauthorized'}, 401)
            trucks = []
            for r in d['track'].values():
                q_ = int((time.time() - time.mktime(time.strptime((r.get('lastLoc') or {}).get('at') or r['startedAt'], '%Y-%m-%dT%H:%M:%SZ'))) / 60)
                trucks.append({**{k: r.get(k) for k in ('token','customer','destination','crew','mover','piano','status','startedAt','lastLoc','etaMin','etaFirst')}, 'drift': (r.get('etaMin') or 0) - (r.get('etaFirst') or 0), 'quietMin': q_, 'path': r.get('path', [])[-40:]})
            return self.send_json({'ok': True, 'trucks': trucks})
        if u.path == '/api/track':
            rec = d['track'].get(q.get('t', [''])[0])
            if not rec: return self.send_json({'error': 'not found'}, 404)
            return self.send_json({'ok': True, **{k: rec.get(k) for k in ('customer', 'destination', 'crew', 'piano', 'status', 'startedAt', 'endedAt', 'lastLoc', 'etaMin')}, 'distMi': None, 'path': rec.get('path', [])[-60:]})
        return super().do_GET()
    def do_POST(self):
        u = urllib.parse.urlparse(self.path); b = self.body(); d = load(); now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
        if u.path == '/api/sm':
            try:
                req = urllib.request.Request(BRIDGE, data=json.dumps(b).encode(), headers={'content-type': 'text/plain;charset=utf-8', 'User-Agent': 'blp-movers-dev'}, method='POST')
                with urllib.request.urlopen(req, timeout=60) as r: t = r.read().decode()
                return self.send_json(json.loads(t))
            except Exception as e: return self.send_json({'error': str(e)}, 502)
        if u.path != '/api/eta-report' and b.get('key') != KEY: return self.send_json({'error': 'unauthorized'}, 401)
        if u.path == '/api/log':
            rec = {'id': now.replace('-', '').replace(':', '')[:14] + '-' + tok(5), 'kind': b.get('kind'), 'at': now, 'who': b.get('who', ''), **(b.get('data') or {})}
            d['log'].append(rec); save(d); return self.send_json({'ok': True, 'id': rec['id']})
        if u.path == '/api/offer':
            if b.get('close'):
                for r in d['offer']:
                    if r['id'] == b['close']: r['status'] = 'won' if b.get('status') == 'won' else 'lost'; r['wonAt'] = now
                save(d); return self.send_json({'ok': True})
            sv = b.get('service') or {}; mv = b.get('move') or {}
            rec = {'id': tok(8), 'at': now, 'mover': b.get('mover', ''), 'mode': b.get('mode'), 'customer': mv.get('customer', ''), 'phone': mv.get('phone', ''), 'piano': mv.get('piano', ''), 'moveId': mv.get('id'),
                   'service': sv.get('name'), 'serviceId': sv.get('id'), 'kind': sv.get('kind'), 'amount': b.get('amount') or 0, 'qty': b.get('qty') or 1, 'payment': b.get('payment', ''), 'note': b.get('note', ''),
                   'bonus': sv.get('bonus') or 0, 'status': 'won' if b.get('mode') == 'sold' else 'open', 'wonAt': now if b.get('mode') == 'sold' else None, 'leadId': 'dev-' + tok(4), 'leadStatus': 'new (dev)'}
            d['offer'].append(rec); save(d); return self.send_json({'ok': True, 'id': rec['id'], 'sms': {'sent': False, 'reason': 'dev server'}, 'leadId': rec['leadId'], 'leadStatus': 'new'})
        if u.path == '/api/schedule':
            d['schedule'][b.get('who', '').lower()] = {'who': b.get('who'), 'schedule': b.get('schedule'), 'summary': b.get('summary', ''), 'updatedAt': now}; save(d)
            return self.send_json({'ok': True, 'texted': [], 'emailed': False, 'dev': True})
        if u.path == '/api/eta':
            t = tok(10); d['track'][t] = {'token': t, 'customer': b.get('customer', 'there'), 'destination': b.get('destination', ''), 'crew': b.get('crew', ''), 'piano': b.get('piano', ''), 'status': 'enroute', 'startedAt': now, 'lastLoc': None, 'path': []}
            save(d); url = 'http://localhost:8642/t/' + t
            return self.send_json({'ok': True, 'token': t, 'url': url, 'sms': {'sent': False, 'reason': 'dev server'}, 'body': b.get('message') or ('Your BLP movers are on the way: ' + url)})
        if u.path == '/api/eta-report':
            rec = d['track'].get(b.get('token', ''))
            if rec: rec['etaMin'] = b.get('etaMin'); rec.setdefault('etaFirst', b.get('etaMin')); save(d)
            return self.send_json({'ok': True})
        if u.path == '/api/location':
            rec = d['track'].get(b.get('token', ''))
            if not rec: return self.send_json({'error': 'unknown session'}, 404)
            if b.get('lat') is not None: rec['lastLoc'] = {'lat': b['lat'], 'lng': b['lng'], 'at': now}; rec['path'] = (rec.get('path') or [])[-400:] + [{'lat': b['lat'], 'lng': b['lng'], 'at': now}]
            if b.get('status') in ('enroute', 'arrived', 'ended'): rec['status'] = b['status']
            save(d); return self.send_json({'ok': True, 'status': rec['status']})
        return self.send_json({'error': 'no such endpoint'}, 404)

if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
    print('BLP Movers dev server on http://localhost:%d' % port)
    ThreadingHTTPServer(('', port), H).serve_forever()
