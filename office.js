/* Office view: every live-ETA session on one Google map, with drift and
 * quiet-phone flags. Polls /api/fleet every 10 s. */
(function () {
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let key = ''; try { key = localStorage.getItem('blpOfficeKey') || ''; } catch (e) {}
  const TRUCK = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 64" width="120" height="64"><rect x="2" y="10" width="78" height="38" rx="4" fill="#151515"/><ellipse cx="41" cy="29" rx="27" ry="11" fill="#151515" stroke="#F6F4EE" stroke-width="2"/><text x="41" y="33" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="10" letter-spacing="1.5" fill="#F6F4EE">PIANOS</text><path d="M80 22h20l14 12v14H80z" fill="#8B1E1E"/><path d="M84 25h13l9 8H84z" fill="#F6F4EE"/><rect x="2" y="46" width="112" height="4" fill="#3a3a3a"/><circle cx="24" cy="52" r="9" fill="#222"/><circle cx="96" cy="52" r="9" fill="#222"/></svg>`);
  let map = null, mapsReady = false, markers = {}, houses = {}, geocoder = null, focus = null;
  $('#go').onclick = () => { key = $('#key').value.trim(); try { localStorage.setItem('blpOfficeKey', key); } catch (e) {} start(); };
  if (key) start();
  async function start() {
    let r;
    try { r = await (await fetch('/api/fleet?key=' + encodeURIComponent(key))).json(); } catch (e) { r = { error: 'offline' }; }
    if (!r.ok) { $('#msg').className = 'msg err'; $('#msg').textContent = r.error === 'unauthorized' ? 'Wrong team key.' : 'Could not reach the site: ' + (r.error || ''); return; }
    $('#gate').hidden = true; $('#office').hidden = false;
    let cfg = {}; try { cfg = await (await fetch('/api/config')).json(); } catch (e) {}
    if (cfg.mapsKey) { window.__init = initMap; const s = document.createElement('script'); s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(cfg.mapsKey) + '&callback=__init'; s.async = true; document.head.appendChild(s); }
    else $('#map').innerHTML = '<div class="empty">Add GOOGLE_MAPS_BROWSER_KEY on the site to see the trucks on a map. The list still updates live.</div>';
    paint(r); setInterval(async () => { try { paint(await (await fetch('/api/fleet?key=' + encodeURIComponent(key), { cache: 'no-store' })).json()); } catch (e) {} }, 10000);
  }
  function initMap() {
    mapsReady = true; geocoder = new google.maps.Geocoder();
    map = new google.maps.Map($('#map'), { center: { lat: 40.28, lng: -111.7 }, zoom: 10, disableDefaultUI: true, zoomControl: true, styles: [{ featureType: 'poi', stylers: [{ visibility: 'off' }] }] });
  }
  function paint(r) {
    if (!r || !r.ok) return;
    $('#stamp').textContent = 'updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    const live = r.trucks.filter(t => t.status === 'enroute');
    $('#trucks').innerHTML = `<h1>Trucks live <small class="lite">${live.length} on the road</small></h1>` + (r.trucks.length ? r.trucks.map(t => {
      const late = t.status === 'enroute' && t.drift >= 10, quiet = t.status === 'enroute' && t.quietMin >= 8;
      const cls = t.status !== 'enroute' ? 'done' : late ? 'late' : quiet ? 'quiet' : '';
      return `<div class="truck ${cls}" data-t="${esc(t.token)}"><div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline"><b>${esc(t.crew || t.mover)}</b><span class="badge ${t.status !== 'enroute' ? 'done' : late ? 'late' : quiet ? 'quiet' : 'ok'}">${t.status !== 'enroute' ? t.status : late ? t.drift + ' min late' : quiet ? 'quiet ' + t.quietMin + ' min' : 'on track'}</span></div>
        <div>${esc(t.customer)}${t.piano ? ' · ' + esc(t.piano) : ''}</div><div class="lite">${esc(t.destination)}</div>
        <div class="st"><span class="eta">${t.status === 'enroute' ? (t.etaMin != null ? t.etaMin + ' min' : '—') : ''}</span>${t.etaFirst != null ? `<span>first estimate ${t.etaFirst} min</span>` : ''}<span>${t.lastLoc ? 'phone ' + t.quietMin + ' min ago' : 'no location yet'}</span><a href="/t/${esc(t.token)}" target="_blank" rel="noopener" style="color:var(--red)">customer link ↗</a></div></div>`;
    }).join('') : '<div class="lite">No trucks are sharing a live ETA right now. They appear here the moment a mover taps "Send the live tracking link".</div>');
    document.querySelectorAll('.truck[data-t]').forEach(el => el.onclick = () => { focus = el.dataset.t; const t = r.trucks.find(x => x.token === focus); if (mapsReady && t && t.lastLoc) { map.panTo(t.lastLoc); map.setZoom(13); } });
    if (!mapsReady) return;
    const seen = new Set();
    for (const t of r.trucks) {
      seen.add(t.token);
      if (t.lastLoc) {
        if (!markers[t.token]) markers[t.token] = new google.maps.Marker({ map, icon: { url: TRUCK, scaledSize: new google.maps.Size(54, 29), anchor: new google.maps.Point(27, 24) }, title: t.crew || t.mover });
        markers[t.token].setPosition(t.lastLoc); markers[t.token].setOpacity(t.status === 'enroute' ? 1 : .4);
      }
      if (!houses[t.token] && t.destination) {
        houses[t.token] = true;
        const place = ll => { houses[t.token] = new google.maps.Marker({ map, position: ll, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#8B1E1E', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 }, title: t.customer }); };
        if (t.destLoc) place(t.destLoc); else geocoder.geocode({ address: t.destination }, (res, st) => { if (st === 'OK' && res[0]) place(res[0].geometry.location); });
      }
    }
    for (const k of Object.keys(markers)) if (!seen.has(k)) { markers[k].setMap(null); delete markers[k]; }
    if (!focus && live.length) { const b = new google.maps.LatLngBounds(); live.forEach(t => t.lastLoc && b.extend(t.lastLoc)); if (!b.isEmpty()) map.fitBounds(b, 60); focus = 'auto'; }
  }
})();
