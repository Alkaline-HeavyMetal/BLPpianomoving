# Deploying BLP Movers

Everything runs on Netlify + one Google Apps Script, like the other BLP apps.

## 1. Netlify site
Create a site from this repo (`main`, publish `.`). Suggested name
`blpmovers` → `https://blpmovers.netlify.app`. Functions build from
`netlify/functions` automatically (`@netlify/blobs` is the only dependency).

Environment variables:

| Var | Needed for | Value |
|---|---|---|
| `BLP_APP_ACCESS_KEY` | all writes | the team key (same as the Sales App; default `pianoman`) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | texting the tracking link | same as the Sales App |
| `TWILIO_MESSAGING_SERVICE_SID` (or `TWILIO_FROM`) | " | the customer-facing A2P messaging service |
| `GOOGLE_MAPS_BROWSER_KEY` | the truck map on the customer page | Maps JavaScript API + Geocoding + Directions enabled; restrict to `https://blpmovers.netlify.app/*` |
| `SALESAPP_URL`, `SALESAPP_PASSCODE` | opening leads in the Sales App from offers | default `https://blpsalesapp.netlify.app`; passcode defaults to `BLP_APP_ACCESS_KEY` |
| `GOOGLE_MAPS_SERVER_KEY` | optional | Geocoding API only; lets the fallback view estimate ETA without the browser key |

Without Twilio the app still works: it opens the mover's Messages app with the
link prefilled. Without a Maps key the customer page shows a simple progress
road instead of the map.

## 2. Movers bridge (Apps Script)
1. script.google.com → New project → paste `apps-script/Movers.gs`.
2. Run `doGet` once to authorize (Calendar, Drive, Sheets).
3. Make sure the account can see the **pianomoving.blp@gmail.com** calendar
   (share it with that account, or deploy from pianomoving.blp).
4. Project settings → Script properties: `MOVERS_KEY` (the team key),
   optionally `DRIVE_ROOT_ID`, `LOG_SHEET_ID`, `OFFICE_NAMES` (e.g. `Melissa,Karmel`).
   Leave the folder/sheet blank and the script creates **BLP Moves** (Drive)
   and **BLP Movers Log** (Sheets) on first use.
5. Deploy → New deployment → Web app → Execute as **Me**, access **Anyone**.
6. Paste the `/exec` URL into `config.js` → `moversBridgeUrl`, commit, push.

Redeploy a new version after any edit to the script (bump `BRIDGE_REV`).

## 3. Add the app to the BLP app lists
- Store Map `index.html` BLP Apps menu and the 💡 box's app list
  (`karmel-spec/BLPMap`) — add "🚚 BLP Movers → https://blpmovers.netlify.app".
- `karmel-spec/BLPagents` → `src/lib/blp-apps.ts` (`BLP_APPS`).

## 4. Phones
Open the site in Safari/Chrome → Share → **Add to Home Screen**. Allow
location when the first live ETA is sent (needed for the truck on the map).
