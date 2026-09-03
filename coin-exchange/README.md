# Class Coin Exchange

Live pages:

- Section 01 — https://au-sm.github.io/spm261/coin-exchange/01/
- Section 02 — https://au-sm.github.io/spm261/coin-exchange/02/

Students just open the link and watch. You sign in with a password to add students,
grant coins, sell, and remove.

## How it works

- **Today tracks Bitcoin live; past days are locked.** Each request re-reads
  Bitcoin's real price (Coinbase spot) and updates today's point. The moment the
  page is first opened on the next day, yesterday's point freezes for good — so
  the chart is one settled value per past day, with today still moving.
- **10x leverage on coins.** A coin is worth `2 * (1 + 10 * (move since grant))`,
  floored at 0. A 3% Bitcoin move since the grant = a 30% swing on the coin.
  Change the `LEVERAGE` constant (top of both `app.js` and `backend.gs`) to retune.
- No cron job, no artifact version to re-publish, no daily step for you.
- Optional: run the `seed()` function in `backend.gs` once to put the three
  test-week days (Aug 30 / 31 / Sep 1) back on the chart.

## Files

| File | What it is |
|---|---|
| `01/index.html`, `02/index.html` | The two section pages (just a shell) |
| `app.js`, `app.css` | Shared front-end |
| `config.js` | Holds the backend URL — **edit this after deploying the backend** |
| `backend.gs` | Google Apps Script Web App — the shared backend for both sections |

## One-time setup

1. Go to **script.google.com → New project**. Paste in `backend.gs`. Save.
2. **Project Settings (⚙) → Script Properties → Add script property**
   - `ADMIN_PW` = a teacher password of your choice
3. **Deploy → New deployment → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**  ← required, so students who aren't signed in can view
   - Deploy, authorize, copy the **Web app URL** (ends in `/exec`).
4. Paste that URL into `config.js` (replace `PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE`), commit, push.
5. Open both pages, click **Teacher sign in**, enter the password, add your rosters.

To change a password later: edit the `ADMIN_PW` script property. To reset a section's
data: delete the `state_01` / `state_02` script property.
