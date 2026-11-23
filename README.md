# Akuma Super Series website

Source for https://akuma-super-series.pages.dev — the ASSDIC tournament site run by Akuma Esports.

- `site/` holds every file that gets published. Pushing to `main` deploys it to Cloudflare Pages automatically (see `.github/workflows/deploy.yml`).
- Schedule, standings, rosters and stats load live from the tabs of the tournament Google Sheet that are published to the web (Schedule, Swiss Stage, Roster Sheet, Raw Data, Player IDs). The published-sheet ID is set in `site/data.js`.
- New subs or alternate accounts: add a row to the **Player IDs** tab in the sheet; no code change needed.
