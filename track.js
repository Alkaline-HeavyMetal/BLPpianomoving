/* Customer-facing live ETA page (Uber-style). Polls /api/track for the
 * mover's last position, draws the route with Google Maps when a browser
 * key is configured, and falls back to a simple progress road otherwise. */
(function () {
  const CFG = window.BLP_MOVERS_CONFIG || {};
  const tok = (location.pathname.match(/\/t\/([a-z0-9]+)/i) || [])[1]
    || new URLSearchParams(location.search).get('t') || '';
  const $ = s => document.querySelector(s);
  $('#callShop').href = 'tel:' + String(CFG.shopPhone || '').replace(/[^\d+]/g, '');

  // BLP box truck, side view, badge on the box — used as the map marker
  const TRUCK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 64" width="120" height="64">
    <rect x="2" y="10" width="78" height="38" rx="4" fill="#151515"/>
    <ellipse cx="41" cy="29" rx="27" ry="11" fill="#151515" stroke="#F6F4EE" stroke-width="2"/>
    <ellipse cx="41" cy="29" rx="24" ry="8.5" fill="none" stroke="#8B1E1E" stroke-width="1"/>
    <text x="41" y="33" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="10" letter-spacing="1.5" fill="#F6F4EE">PIANOS</text>
    <path d="M80 22h20l14 12v14H80z" fill="#8B1E1E"/>
    <path d="M84 25h13l9 8H84z" fill="#F6F4EE"/>
    <rect x="2" y="46" width="112" height="4" fill="#3a3a3a"/>
    <circle cx="24" cy="52" r="9" fill="#222"/><circle cx="24" cy="52" r="4" fill="#bbb"/>
    <circle cx="96" cy="52" r="9" fill="#222"/><circle cx="96" cy="52" r="4" fill="#bbb"/>
  </svg>`;
  const TRUCK_URL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(TRUCK_SVG);
  $('#fbTruck').src = TRUCK_URL;

  if (!tok) { document.body.innerHTML = '<div class="msg">This tracking link is missing its code. Please text us for an update.</div>'; return; }

  let map = null, truck = null, house = null, line = null, dirs = null, geocoder = null;
  let destLL = null, mapsReady = false, lastFix = null, target = null, animFrom = null, animAt = 0;
  let ended = false, startDist = null;

  async function boot() {
    let cfg = {};
    try { cfg = await (await fetch('/api/config')).json(); } catch (e) {}
    if (cfg.mapsKey) {
      window.__blpMapsInit = initMap;
      const s = document.createElement('script');
      s.src = 'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(cfg.mapsKey) + '&callback=__blpMapsInit&libraries=geometry';
      s.async = true; s.onerror = () => showFallback();
      document.head.appendChild(s);
    } else showFallback();
    poll();
    setInterval(poll, 5000);
    requestAnimationFrame(tick);
  }
  function showFallback() { $('#fallback').classList.add('show'); }

  function initMap() {
    mapsReady = true;
    map = new google.maps.Map($('#map'), {
      center: { lat: 40.28, lng: -111.7 }, zoom: 11, disableDefaultUI: true, gestureHandling: 'greedy',
      styles: [{ featureType: 'poi', stylers: [{ visibility: 'off' }] }, { featureType: 'transit', stylers: [{ visibility: 'off' }] }],
    });
    geocoder = new google.maps.Geocoder();
    dirs = new google.maps.DirectionsService();
    truck = new google.maps.Marker({ map, icon: { url: TRUCK_URL, scaledSize: new google.maps.Size(60, 32), anchor: new google.maps.Point(30, 26) }, zIndex: 10, optimized: false });
    house = new google.maps.Marker({ map, icon: { path: google.maps.SymbolPath.CIRCLE, scale: 9, fillColor: '#8B1E1E', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 3 }, zIndex: 5 });
    line = new google.maps.Polyline({ map, strokeColor: '#151515', strokeOpacity: .85, strokeWeight: 4 });
  }

  async function poll() {
    let d;
    try { d = await (await fetch('/api/track?t=' + encodeURIComponent(tok), { cache: 'no-store' })).json(); }
    catch (e) { return; }
    if (!d || !d.ok) { if (d && d.error === 'not found') document.body.innerHTML = '<div class="msg">We could not find this move. The link may have expired — please text us for an update.</div>'; return; }
    $('#who').textContent = (d.crew ? d.crew + ' from ' : '') + 'Brigham Larson Pianos';
    $('#dest').textContent = (d.piano ? d.piano + ' → ' : '') + (d.destination || '');
    if (mapsReady && !destLL && d.destination) {
      geocoder.geocode({ address: d.destination }, (res, st) => {
        if (st === 'OK' && res[0]) { destLL = res[0].geometry.location; house.setPosition(destLL); fit(); }
      });
    }
    if (d.lastLoc) {
      const p = { lat: d.lastLoc.lat, lng: d.lastLoc.lng };
      if (!lastFix) { lastFix = p; target = p; animFrom = p; }
      else if (p.lat !== target.lat || p.lng !== target.lng) { animFrom = current(); target = p; animAt = performance.now(); }
      lastFix = p;
      if (mapsReady && destLL) route(p);
      fallbackProgress(p, d);
    }
    stage(d);
  }
  function current() {
    if (!animFrom || !target) return target || null;
    const t = Math.min(1, (performance.now() - animAt) / 4500);
    return { lat: animFrom.lat + (target.lat - animFrom.lat) * t, lng: animFrom.lng + (target.lng - animFrom.lng) * t };
  }
  function tick() {
    const c = current();
    if (c && mapsReady && truck) truck.setPosition(c);
    requestAnimationFrame(tick);
  }
  let routing = false, lastRouteAt = 0;
  function route(p) {
    if (routing || Date.now() - lastRouteAt < 15000 || ended) return;
    routing = true; lastRouteAt = Date.now();
    dirs.route({ origin: p, destination: destLL, travelMode: 'DRIVING', drivingOptions: { departureTime: new Date() } }, (res, st) => {
      routing = false;
      if (st !== 'OK') return;
      const leg = res.routes[0].legs[0];
      line.setPath(res.routes[0].overview_path);
      const sec = (leg.duration_in_traffic || leg.duration).value;
      setEta(Math.max(1, Math.round(sec / 60)), leg.distance.text);
      if (!fitted) fit();
    });
  }
  let fitted = false;
  function fit() {
    if (!map) return;
    const b = new google.maps.LatLngBounds();
    if (destLL) b.extend(destLL);
    if (lastFix) b.extend(lastFix);
    if (!b.isEmpty()) { map.fitBounds(b, 70); fitted = !!(destLL && lastFix); }
  }
  function setEta(min, distText) {
    if (ended) return;
    $('#eta').innerHTML = '<small>Arriving in about</small>' + min + ' min' + (distText ? ' <span style="font-size:14px;font-family:Open Sans,sans-serif;font-weight:600;color:#6B6760">· ' + distText + '</span>' : '');
    if (min <= 5) markStage(1);
  }
  function fallbackProgress(p, d) {
    if (mapsReady) return;
    const dist = d.distMi;
    if (d.etaMin != null) setEta(d.etaMin, dist != null ? dist.toFixed(1) + ' mi' : '');
    else if (dist != null) setEta(Math.max(1, Math.round(dist / 28 * 60)), dist.toFixed(1) + ' mi');
    if (dist != null) {
      if (startDist == null || dist > startDist) startDist = dist;
      const pct = startDist ? Math.min(98, Math.max(2, 100 - dist / startDist * 100)) : 10;
      $('#fbTruck').style.left = pct + '%';
    }
  }
  function markStage(i) {
    const s = $('#stages').children;
    for (let k = 0; k < s.length; k++) s[k].className = k < i ? 'done' : k === i ? 'on' : '';
  }
  function stage(d) {
    if (d.status === 'arrived') {
      ended = true; markStage(2);
      $('#eta').innerHTML = '<small>Good news</small>We’re here';
      $('#tip').innerHTML = '<b>Next</b>Your movers will walk the path with you and note the piano’s condition before it moves.';
    } else if (d.status === 'ended') {
      ended = true;
      $('#eta').innerHTML = '<small>Tracking ended</small>Thank you';
      $('#tip').innerHTML = '<b>Thank you</b>We hope your piano brings years of music. Questions? Tap Call the shop.';
      $('#stages').hidden = true;
    } else if (!d.lastLoc) {
      $('#eta').innerHTML = '<small>Your movers are</small>getting ready';
    }
  }
  boot();
})();
