# BLP Movers — Brigham Larson Pianos

Mobile web app for the piano moving crew. Every scheduled move on the
**pianomoving.blp** Google Calendar shows up as a card on the day's board with
the two things a mover taps most — **Navigate** (Google Maps) and **Text ETA**
(an Uber-style live tracking link with the BLP truck on a map) — plus stairs,
bench, gate code and balance to collect at a glance.

Live site: `https://blpmovers.netlify.app` (auto-deploys from `main`).
Design: "Ivory Keys" — ivory ground, black hairline rules, Playfair Display
for times and names, Open Sans for everything else, oxblood red only for the
Text ETA button and the stairs warning.

## What it does

| Feature | Where | How |
|---|---|---|
| Today's moves, one card each | `#today` | calendar events via `apps-script/Movers.gs` (`?fn=moves`), parsed in `app.js` (`parseMove`) |
| Navigate / route the whole day | card · bottom of board | Google Maps URLs, no API key needed |
| Text ETA — live tracking link | card → Text ETA | `/api/eta` texts the customer `https://<site>/t/<token>` (Twilio); the phone streams its position to `/api/location`; `track.html` polls `/api/track` and draws the truck + route + ETA with Google Maps |
| Late / arrived / thank-you texts | card → Text ETA | prefilled `sms:` links (open the phone's Messages app) |
| Condition report | card → Condition report | photos downscaled and posted to the bridge → the move's Drive folder (`BLP Moves/<year>/<date — customer — piano>`) with `move-details.txt` (the calendar details), a report `.txt` + `.json`, the signature, and a row on the **Condition Reports** sheet; big videos go straight to Drive through a resumable session; the folder link is appended to the calendar event |
| Bench yes/no, accessories, actual stairs, per-area condition, works-checks, signature | condition report | |
| Move differs → change order | card → $ Move differs | priced add-ons with quantities, reason, customer signature → **Change Orders** sheet, calendar note, office texted |
| Customer interested → offer | card → ✦ Customer interested, or the Services tab | pick the item → the customer gets a friendly marketing text (`/api/offer`, Twilio), a **New Lead opens in the BLP Sales App** with "Mover offer — <name>" as Source of Business (duplicates by phone become a timeline note), the **Service Interest** sheet gets a row, and the mover's bonus is tracked. Truck products (caster cups, polish kit) can be **sold on site**, which opens the lead as "Won — sold on site" and credits the bonus at once. Bonus amounts are placeholders in `app.js` (`CATALOG`). |
| Truck checklist, week view, my reports | drawer | |
| Mover dashboard | Me tab | BLP Work Clock in/out and clock into a piano by serial (Store Map bridge), schedule + time off with office alerts, payroll history + clock-fix requests, services offered with WON highlighting and the monthly bonus tally |
| Office view | `office.html` | every truck sharing a live ETA on one map; late (10+ min behind the first estimate) and quiet-phone (8+ min) flags; `fleet-watch` texts the office once per condition |
| 💡 Suggest an improvement | top bar | Store Map bridge `action:'suggest'`, app "BLP Movers" → Store Map → Admin → App Requests (same fix list as every BLP app; Brigham logs shipped items on App Updates) |

## Sign-in
Google sign-in for BLP accounts (brighamlarsonpianos.com, the shop's *.blp@gmail.com, Brigham), same OAuth client as the Store Map. The team password is the fallback until Google is verified everywhere.

## Run it locally

```sh
python3 server.py
# open http://localhost:8642
```

`server.py` serves the app and mirrors the Netlify functions: `/api/sm` is
proxied to the real Store Map bridge (so the time clock and payroll history
are live), and offers / logs / schedules / ETA sessions are kept in
`.dev-data.json`. Without a Movers bridge URL in `config.js` the board runs
on `data/demo-moves.json`.

## Files

- `index.html`, `styles.css`, `app.js` — the crew app (single page, hash routes)
- `track.html`, `track.js` — the customer's live ETA page
- `config.js` — public config: bridge URLs, team key, shop phone
- `netlify/functions/` — `eta`, `location`, `track` (live ETA, Netlify Blobs), `offer` + `offers-sweep` (offers, Sales App leads, WON watch), `schedule`, `log`, `config`, `sm` (proxy to the Store Map bridge for the Work Clock, Time Log, clock fixes, time off and 💡 requests)
- `apps-script/Movers.gs` — Google bridge: calendar read, Drive uploads, sheet rows, calendar notes
- `data/demo-moves.json` — example day
- `DEPLOY.md` — one-time setup

## Calendar event conventions the parser understands

Labeled lines in the event description win: `Customer:`, `Phone:`, `Piano:`,
`From:`, `To:`, `Stairs:`, `Bench:`. Free text also works: a phone number
anywhere, "14 stairs up", "one flight", "no stairs", "no bench", a make name
(Yamaha, Kawai, Hailun, Baldwin, Steinway…), "SN 12345", "$495", "collect
$245", "gate 4471", "legs and lyre". The Store Map's conventions carry over:
`Josh/Thayne: …` for the crew and a leading `x ` for done.
