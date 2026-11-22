/* =====================================================================
   TCG ISEKAZ — Salle de jeux : Pixel, Zoom, Pari + bonus connexion Discord
   Dépend de app.js : state, saveState, showToast, todayKey, CARD_DATABASE, currentUser
   ===================================================================== */
const GAME_DAILY_PLAYS = 3;     // parties par jour et par mode (Pixel / Zoom)
const DISCORD_BONUS = 300;      // cadeau unique à la première connexion Discord
const BET_OPTIONS = [10, 25, 50, 100, 250];
const BET_MULT = 2.7;           // gain si on trouve la bonne carte (1 chance sur 3 => 90 % de retour)
const PIXEL_CELLS = [6, 8, 10, 12, 16];
const PIXEL_REWARD = { 6: 30, 8: 25, 10: 22, 12: 20, 16: 15 };
const ZOOM_FRACS = [0.18, 0.22, 0.28, 0.34];
const ZOOM_REWARD = { 0.18: 30, 0.22: 25, 0.28: 20, 0.34: 15 };

let gameTab = "pixel";
let gRound = null;              // manche en cours (Pixel / Zoom)
let gBet = 50;
let gBetState = null;           // { bet, mults, picked, done }

const gRand = arr => arr[Math.floor(Math.random() * arr.length)];
function gShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ---------- Bonus de première connexion Discord ---------- */
function grantDiscordBonus() {
  if (!currentUser || state.discordBonus) return;
  state.discordBonus = true;
  state.coins += DISCORD_BONUS;
  saveState();
  showToast(`🎉 Bienvenue ! Bonus de connexion Discord : +🪙 ${DISCORD_BONUS}`);
}

/* ---------- Parties du jour ---------- */
function gamesState() {
  const t = todayKey();
  if (!state.games || state.games.day !== t) state.games = { day: t, pixel: 0, zoom: 0 };
  return state.games;
}
const playsLeft = mode => Math.max(0, GAME_DAILY_PLAYS - gamesState()[mode]);

/* ---------- Dessin des images ---------- */
function loadImg(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
function drawPixelated(canvas, img, cells) {
  const W = canvas.width;
  // réduction progressive (moyenne correcte des couleurs), puis agrandissement sans lissage
  let cur = document.createElement("canvas");
  cur.width = cur.height = img.naturalWidth || 512;
  cur.getContext("2d").drawImage(img, 0, 0, cur.width, cur.height);
  while (cur.width / 2 > cells) {
    const next = document.createElement("canvas");
    next.width = next.height = Math.max(cells, Math.floor(cur.width / 2));
    next.getContext("2d").drawImage(cur, 0, 0, next.width, next.height);
    cur = next;
  }
  const small = document.createElement("canvas");
  small.width = small.height = cells;
  small.getContext("2d").drawImage(cur, 0, 0, cells, cells);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(small, 0, 0, cells, cells, 0, 0, W, W);
}
function drawZoom(canvas, img, p) {
  const s = (img.naturalWidth || 512) * p.frac;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, p.x * ((img.naturalWidth || 512) - s), p.y * ((img.naturalHeight || 512) - s), s, s, 0, 0, canvas.width, canvas.height);
}
function drawFull(canvas, img) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
}
async function paintRound() {
  const canvas = document.getElementById("game-canvas");
  if (!canvas || !gRound) return;
  const img = await loadImg(gRound.card.image).catch(() => null);
  if (!img || !document.getElementById("game-canvas")) return;
  if (gRound.answered) drawFull(canvas, img);
  else if (gRound.mode === "pixel") drawPixelated(canvas, img, gRound.params.cells);
  else drawZoom(canvas, img, gRound.params);
}

/* ---------- Manche Pixel / Zoom ---------- */
function startRound(mode) {
  if (playsLeft(mode) <= 0) return showToast("⏳ Plus de parties aujourd'hui pour ce jeu, reviens demain !");
  const pool = CARD_DATABASE.filter(c => c.image);
  if (pool.length < 4) return showToast("❌ Pas assez de cartes illustrées pour jouer.");
  const card = gRand(pool);
  const options = gShuffle([card, ...gShuffle(pool.filter(c => c.id !== card.id)).slice(0, 3)]);
  let params, reward;
  if (mode === "pixel") {
    const cells = gRand(PIXEL_CELLS);
    params = { cells };
    reward = PIXEL_REWARD[cells];
  } else {
    const frac = gRand(ZOOM_FRACS);
    params = { frac, x: Math.random(), y: Math.random() };
    reward = ZOOM_REWARD[frac];
  }
  gamesState()[mode] += 1;      // la partie est comptée dès le début (anti-rafraîchissement)
  gRound = { mode, card, options, params, reward, answered: false, picked: null };
  saveState();
  renderGames();
}
function answerRound(cardId) {
  if (!gRound || gRound.answered) return;
  gRound.answered = true;
  gRound.picked = cardId;
  const ok = cardId === gRound.card.id;
  if (ok) {
    state.coins += gRound.reward;
    showToast(`✅ Bravo ! C'était bien ${gRound.card.name} : +🪙 ${gRound.reward}`);
  } else {
    showToast(`❌ Raté ! C'était ${gRound.card.name}.`);
  }
  saveState();
  renderGames();
}

/* ---------- Pari des 3 cartes ---------- */
function startBet(index) {
  if (gBetState && !gBetState.done) return;
  if (state.coins < gBet) return showToast("❌ Pas assez de pièces pour cette mise.");
  state.coins -= gBet;
  const win = Math.floor(Math.random() * 3);
  gBetState = { bet: gBet, win, picked: index, done: true };
  const gain = index === win ? Math.round(gBet * BET_MULT) : 0;
  if (gain) state.coins += gain;
  gBetState.gain = gain;
  saveState();
  renderGames();
  if (gain) showToast(`🍀 Gagné ! +🪙 ${gain} (mise ${gBet})`);
  else showToast(`💸 Perdu… −🪙 ${gBet}`);
}

/* ---------- Rendu ---------- */
function renderGames() {
  const root = document.getElementById("games-root");
  if (!root) return;
  const tabs = [["pixel", "🔳 PIXEL"], ["zoom", "🔍 ZOOM"], ["bet", "🎲 PARI"]];
  let html = `<div class="game-tabs">${tabs.map(([k, l]) =>
    `<button class="game-tab${gameTab === k ? " active" : ""}" data-game="${k}">${l}</button>`).join("")}</div>`;

  if (gameTab === "bet") html += renderBetHTML();
  else html += renderGuessHTML(gameTab);
  root.innerHTML = html;
  if (gameTab !== "bet") paintRound();
}

function renderGuessHTML(mode) {
  const left = playsLeft(mode);
  const title = mode === "pixel" ? "Devine la carte pixelisée" : "Devine la carte zoomée";
  const desc = mode === "pixel"
    ? "L'image est pixelisée de façon aléatoire : plus c'est flou, plus la récompense est grosse."
    : "Un détail aléatoire de l'illustration est agrandi : plus le détail est petit, plus la récompense est grosse.";
  let html = `<div class="game-panel"><h2 class="game-title">${title}</h2><p class="game-desc">${desc}<br>
    <strong>${left}/${GAME_DAILY_PLAYS}</strong> partie${left > 1 ? "s" : ""} restante${left > 1 ? "s" : ""} aujourd'hui.</p>`;

  if (gRound && gRound.mode === mode) {
    html += `<div class="game-canvas-wrap${gRound.answered ? " revealed" : ""}"><canvas id="game-canvas" width="384" height="384"></canvas></div>
      <p class="game-reward">Récompense : 🪙 ${gRound.reward}</p>
      <div class="game-options">${gRound.options.map(o => {
        let cls = "game-option";
        if (gRound.answered) {
          if (o.id === gRound.card.id) cls += " correct";
          else if (o.id === gRound.picked) cls += " wrong";
        }
        return `<button class="${cls}" data-answer="${o.id}" ${gRound.answered ? "disabled" : ""}>${o.name}</button>`;
      }).join("")}</div>`;
    if (gRound.answered) {
      html += left > 0
        ? `<button class="btn-primary" data-next="${mode}">CARTE SUIVANTE</button>`
        : `<p class="game-desc">C'était la dernière partie du jour. À demain !</p>`;
    }
  } else {
    html += left > 0
      ? `<button class="btn-primary" data-next="${mode}">JOUER</button>`
      : `<p class="game-desc">Plus de partie aujourd'hui. Reviens demain !</p>`;
  }
  return html + `</div>`;
}

function renderBetHTML() {
  const done = gBetState && gBetState.done;
  let html = `<div class="game-panel"><h2 class="game-title">Pari des 3 cartes</h2>
    <p class="game-desc">Choisis ta mise, puis une carte face cachée : une seule cache la victoire et rapporte <strong>×${BET_MULT}</strong> ta mise. Les autres ne rapportent rien. Pièces virtuelles, pour le fun !</p>
    <div class="bet-options">${BET_OPTIONS.map(b =>
      `<button class="bet-chip${b === gBet ? " active" : ""}" data-bet="${b}">🪙 ${b}</button>`).join("")}</div>
    <div class="bet-cards">`;
  for (let i = 0; i < 3; i++) {
    let cls = "bet-card", face = "?";
    if (done) {
      cls += " flipped";
      if (i === gBetState.win) { cls += " win"; face = `×${BET_MULT}`; }
      else { cls += " lose"; face = "✕"; }
      if (i === gBetState.picked) cls += " picked";
    }
    html += `<button class="${cls}" data-pick="${i}" ${done ? "disabled" : ""}><span>${face}</span></button>`;
  }
  html += `</div>`;
  if (done) {
    html += `<p class="game-reward ${gBetState.gain ? "good" : "bad"}">${gBetState.gain
      ? `Gagné : +🪙 ${gBetState.gain}` : `Perdu : −🪙 ${gBetState.bet}`}</p>
      <button class="btn-primary" data-again="1">REJOUER</button>`;
  } else {
    html += `<p class="game-desc">Mise : 🪙 ${gBet} — clique sur une carte pour parier.</p>`;
  }
  return html + `</div>`;
}

/* ---------- Événements ---------- */
document.addEventListener("click", e => {
  const root = document.getElementById("games-root");
  if (!root || !root.contains(e.target)) return;
  const t = e.target.closest("button");
  if (!t) return;
  if (t.dataset.game) { gameTab = t.dataset.game; renderGames(); }
  else if (t.dataset.next) startRound(t.dataset.next);
  else if (t.dataset.answer) answerRound(t.dataset.answer);
  else if (t.dataset.bet) { gBet = Number(t.dataset.bet); gBetState = null; renderGames(); }
  else if (t.dataset.pick !== undefined) startBet(Number(t.dataset.pick));
  else if (t.dataset.again) { gBetState = null; renderGames(); }
});
document.querySelectorAll('.nav-btn[data-tab="games"]').forEach(b => b.addEventListener("click", renderGames));
renderGames();
