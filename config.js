// BLP Movers — public config. Nothing here is secret: writes are gated by
// the team key on the server side, same pattern as the other BLP apps.
window.BLP_MOVERS_CONFIG = {
  appName: 'BLP Movers',
  // Movers bridge: apps-script/Movers.gs deployed as a web app (Deploy →
  // New deployment → Web app → execute as me, anyone). Paste the /exec URL.
  // Leave blank and the app runs on data/demo-moves.json so it can be tried.
  moversBridgeUrl: '',
  // Store Map bridge (apps-script/DailyReport.gs in the BLPMap repo). The 💡
  // button files bugs / ideas here as action:'suggest' with app 'BLP Movers',
  // so they show in Store Map → Admin → 💡 App Requests like every other app.
  storeMapBridgeUrl: 'https://script.google.com/macros/s/AKfycbxY4BKnr_Tr0iCTc9itCWhNYLvgszmkI1IoYSkbBWpyAqRtWI-yaUkJQjcVdgG58KXt/exec',
  // Team key for writes (same value as BLP_APP_ACCESS_KEY on the Netlify site).
  teamKey: 'pianoman',
  // Shop / office contact used in customer texts and the tracking page.
  shopPhone: '801-769-0054',
  shopName: 'Brigham Larson Pianos',
  reviewUrl: 'https://g.page/r/brighamlarsonpianos/review',
  // Home base for "Route my day" (first stop of the driving directions).
  homeBase: '1497 S State St, Orem, UT 84058',
};
