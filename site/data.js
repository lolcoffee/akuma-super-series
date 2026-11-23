// Live data from the ASSDIC Google Sheet (only the tabs published to the web).
// After publishing, paste the ID from the published link (the part after /d/e/ and before /pub).
const SHEET_PUB_ID = "2PACX-1vQYp0osBu0bMsBKIpbUVLVlbbTSKy5GRiHFlED6KvbENpPpRaPjgj5kat4A21z-mXM2Mp0QgoUCh1ES";
const GID = { schedule: "404955022", swiss: "8507887", rosters: "1596209432", raw: "1566885465", players: "1916511139" };

async function loadTab(name) {
  if (!SHEET_PUB_ID) throw new Error("not-configured");
  const url = `https://docs.google.com/spreadsheets/d/e/${SHEET_PUB_ID}/pub?gid=${GID[name]}&single=true&output=csv&t=${Date.now()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status);
  return parseCSV(await res.text());
}

function parseCSV(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const at = (rows, r, c) => ((rows[r] || [])[c] || "").trim();

function esc(s) {
  return String(s).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function showError(el, err) {
  el.innerHTML = err.message === "not-configured"
    ? '<p class="note">Live results are being connected. Check back soon.</p>'
    : '<p class="note">Couldn\'t load the latest data right now. Please refresh in a minute.</p>';
}

// Schedule tab: round headers in column B, match rows have "Codes" in B.
function parseSchedule(rows) {
  const rounds = []; let cur = null;
  for (const r of rows) {
    const b = (r[1] || "").trim();
    if (/^(ROUND|QUARTER|SEMI|FINALS)/i.test(b)) { cur = { title: b, matches: [] }; rounds.push(cur); continue; }
    if (cur && b === "Codes" && (r[3] || "").trim() !== "Team") {
      const a = (r[3] || "").trim(), bTeam = (r[4] || "").trim(), res = (r[5] || "").trim();
      let sa = "", sb = "", winner = "";
      const m = res.match(/^(\d+)-(\d+)\s+(.+)$/);
      if (m) {
        winner = m[3].trim();
        const hi = m[1], lo = m[2];
        if (winner === a) { sa = hi; sb = lo; } else { sa = lo; sb = hi; }
      }
      cur.matches.push({ date: (r[2] || "").trim(), a, b: bTeam, sa, sb, winner });
    }
  }
  return rounds;
}

// ---------- Rosters (team code -> name) ----------
function parseRosters(rows) {
  const teams = [];
  for (const codeRow of [8, 24]) for (let c = 1; c < 26; c += 4) {
    const code = at(rows, codeRow, c + 1), name = at(rows, codeRow + 4, c);
    if (code && name) teams.push({ code, name });
  }
  return teams;
}

// ---------- Stats engine (Raw Data + Player IDs) ----------
const num = v => { const n = parseFloat(String(v).replace(/[,%$]/g, "")); return isNaN(n) ? 0 : n; };
const keyOf = s => String(s).trim().toLowerCase();
const playerUrl = id => "/player?p=" + encodeURIComponent(id);
const teamUrl = code => "/team?t=" + encodeURIComponent(code);
const fmt = (n, d = 1) => (isFinite(n) ? n.toFixed(d) : "0");
const pct = n => (isFinite(n) ? Math.round(n * 100) + "%" : "0%");

function blankAgg() {
  return { gp: 0, w: 0, k: 0, d: 0, a: 0, cs: 0, min: 0, dmg: 0, gold: 0, vis: 0, kp: 0, fb: 0, ft: 0, solo: 0, champs: {}, games: [] };
}
function addGame(agg, g) {
  agg.gp++; agg.w += g.win; agg.k += g.k; agg.d += g.d; agg.a += g.a; agg.cs += g.cs; agg.min += g.min;
  agg.dmg += g.dmg; agg.gold += g.gold; agg.vis += g.vis; agg.kp += g.kp; agg.fb += g.fb; agg.ft += g.ft; agg.solo += g.solo;
  const c = agg.champs[g.champ] || (agg.champs[g.champ] = { gp: 0, w: 0, k: 0, d: 0, a: 0 });
  c.gp++; c.w += g.win; c.k += g.k; c.d += g.d; c.a += g.a;
  agg.games.push(g);
}
function derive(agg) {
  return Object.assign(agg, {
    l: agg.gp - agg.w,
    kda: (agg.k + agg.a) / Math.max(1, agg.d),
    csm: agg.cs / Math.max(1, agg.min), dpm: agg.dmg / Math.max(1, agg.min),
    gpm: agg.gold / Math.max(1, agg.min), vsm: agg.vis / Math.max(1, agg.min),
    kpAvg: agg.kp / Math.max(1, agg.gp), wr: agg.w / Math.max(1, agg.gp)
  });
}

async function loadStats() {
  const [raw, pids, rost] = await Promise.all([loadTab("raw"), loadTab("players"), loadTab("rosters")]);
  const teamName = {}; parseRosters(rost).forEach(t => teamName[t.code] = t.name);

  // Player registry
  const players = {}, alias = {};
  for (let r = 1; r < pids.length; r++) {
    const id = at(pids, r, 0); if (!id) continue;
    players[id] = { id, team: at(pids, r, 2), role: at(pids, r, 3), type: at(pids, r, 4) || "Drafted",
      subFor: at(pids, r, 5), price: at(pids, r, 6), stats: blankAgg() };
    alias[keyOf(id)] = id;
    at(pids, r, 1).split(",").map(s => s.trim()).filter(Boolean).forEach(a => alias[keyOf(a)] = id);
  }

  // Games
  const games = [], teamsAgg = {}, champAgg = {}, matches = {};
  for (let r = 1; r < raw.length; r++) {
    const row = raw[r]; const name = (row[2] || "").trim(); if (!name) continue;
    let id = alias[keyOf(name)];
    if (!id) { id = name; alias[keyOf(name)] = id; players[id] = { id, team: (row[1] || "").trim(), role: (row[3] || "").trim(), type: "Sub", subFor: "", price: "", stats: blankAgg() }; }
    const g = {
      date: (row[0] || "").trim(), team: (row[1] || "").trim(), player: id, role: (row[3] || "").trim(), side: (row[4] || "").trim(),
      win: num(row[5]) > 0 ? 1 : 0, champ: (row[7] || "").trim(), k: num(row[8]), d: num(row[9]), a: num(row[10]),
      kp: num(row[12]), fb: num(row[13]), dmg: num(row[14]), vis: num(row[16]), cs: num(row[21]), gold: num(row[23]),
      gd15: num(row[27]), csd15: num(row[30]), ft: num(row[33]), solo: num(row[37]), min: num(row[43]), match: (row[45] || "").trim()
    };
    games.push(g);
    (matches[g.match] || (matches[g.match] = [])).push(g);
    addGame(players[id].stats, g);
    const ch = champAgg[g.champ] || (champAgg[g.champ] = { champ: g.champ, gp: 0, w: 0, k: 0, d: 0, a: 0, players: {} });
    ch.gp++; ch.w += g.win; ch.k += g.k; ch.d += g.d; ch.a += g.a; ch.players[id] = (ch.players[id] || 0) + 1;
  }
  // Opponents + team aggregates (one entry per team per game)
  for (const [mid, list] of Object.entries(matches)) {
    const codes = [...new Set(list.map(g => g.team))];
    list.forEach(g => g.opp = codes.find(c => c !== g.team) || "");
    for (const code of codes) {
      const mine = list.filter(g => g.team === code);
      const t = teamsAgg[code] || (teamsAgg[code] = { code, gp: 0, w: 0, k: 0, d: 0, min: 0, fb: 0, ft: 0, blueGp: 0, blueW: 0, picks: {}, games: [] });
      const win = mine[0].win, side = mine[0].side;
      t.gp++; t.w += win; t.min += mine[0].min;
      t.k += mine.reduce((s, g) => s + g.k, 0); t.d += mine.reduce((s, g) => s + g.d, 0);
      t.fb += mine.some(g => g.fb > 0) ? 1 : 0; t.ft += mine.some(g => g.ft > 0) ? 1 : 0;
      if (/blue/i.test(side)) { t.blueGp++; t.blueW += win; }
      mine.forEach(g => t.picks[g.champ] = (t.picks[g.champ] || 0) + 1);
      t.games.push({ match: mid, date: mine[0].date, opp: mine[0].opp, win, side, min: mine[0].min, picks: mine });
    }
  }
  Object.values(players).forEach(p => derive(p.stats));
  return { players, alias, games, teams: teamsAgg, champs: champAgg, teamName };
}

// ---------- Champion icons (Riot Data Dragon) ----------
let _dd = null;
async function champIcons() {
  if (_dd) return _dd;
  try {
    const v = (await (await fetch("https://ddragon.leagueoflegends.com/api/versions.json")).json())[0];
    const data = (await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${v}/data/en_US/champion.json`)).json()).data;
    const map = {}; const norm = s => s.toLowerCase().replace(/[^a-z]/g, "");
    Object.values(data).forEach(c => { map[norm(c.name)] = c.id; map[norm(c.id)] = c.id; });
    _dd = name => { const id = map[norm(name)]; return id ? `https://ddragon.leagueoflegends.com/cdn/${v}/img/champion/${id}.png` : ""; };
  } catch (e) { _dd = () => ""; }
  return _dd;
}
function champCell(icon, name) {
  const src = icon(name);
  return '<span class="champ">' + (src ? '<img src="' + src + '" alt="" loading="lazy">' : '') + esc(name) + '</span>';
}

// Sortable tables: click a header with data-k to sort by that key.
function sortableTable(el, cols, rows, initial) {
  let key = initial, dir = -1;
  const draw = () => {
    const sorted = rows.slice().sort((x, y) => {
      const a = x[key], b = y[key];
      return (typeof a === "string" ? a.localeCompare(b) : a - b) * dir;
    });
    el.innerHTML = '<div class="scroll"><table><tr>' + cols.map(c => '<th class="' + (c.num ? "num " : "") + 'sort' + (c.k === key ? " on" : "") + '" data-k="' + c.k + '">' + c.label + '</th>').join("") + '</tr>' +
      sorted.map(r => '<tr>' + cols.map(c => '<td' + (c.num ? ' class="num"' : '') + '>' + c.show(r) + '</td>').join("") + '</tr>').join("") + '</table></div>';
    el.querySelectorAll("th[data-k]").forEach(th => th.onclick = () => {
      const k = th.dataset.k; dir = k === key ? -dir : (typeof rows[0]?.[k] === "string" ? 1 : -1); key = k; draw();
    });
  };
  draw();
}
