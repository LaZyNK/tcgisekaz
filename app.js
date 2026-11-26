const SAVE_KEY = "tcg_studio_save_v1";
const FREE_PACK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes entre chaque booster gratuit
const PACK_COST = 150;
const ISEKAZ_COST = 50;               // prix du booster Isekaz en diamants
const ISEKAZ_CARDS = 10;              // 9 cartes des 3 éditions + 1 carte exclusive
const ISEKAZ_HANDMADE_CHANCE = 0.03;  // chance, par booster, que la carte exclusive soit une « faite main »
const DAILY_GEMS = 10;                // diamants du bonus quotidien
const DAILY_BASE = 100;       // bonus quotidien de base
const DAILY_STREAK_STEP = 25; // +25 par jour consécutif
const DAILY_STREAK_MAX = 6;   // plafonné à +150 (jour 7 et suivants = 250)
const DISCOVERY_BONUS = { C: 5, UC: 10, R: 25, UR: 60, SEC: 150 }; // 1re fois qu'on obtient une carte

/* --- HORLOGE & JOUR (fuseau de Paris, aligné sur le serveur) --- */
let clockSkew = 0;                       // décalage entre l'horloge du serveur et celle de l'appareil
const nowMs = () => Date.now() + clockSkew;
const PARIS_DAY = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" });
function todayKey(offset = 0) { return PARIS_DAY.format(new Date(nowMs() + offset * 86400000)); }

/* --- MODE SERVEUR : connecté + synchronisé = toutes les règles sont appliquées par la fonction "game" --- */
function serverMode() { return !!currentUser && syncedFor === currentUser.id; }
function blocked() {                    // connecté mais pas encore synchronisé : on attend
  if (currentUser && !serverMode()) { showToast("☁️ Synchronisation en cours, un instant…"); return true; }
  return false;
}
function applyServer(r) {
  if (!r || !r.state) return;
  if (r.now) clockSkew = r.now - Date.now();
  const edition = state.edition;
  state = migrateState(r.state);
  if (EDITIONS[edition]) state.edition = edition;   // l'édition affichée reste un choix local
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (_) {}
  updateUI();
  if (r.completeGems > 0) setTimeout(() => showToast(`💎 Carte complète : +💎 ${r.completeGems}`), 400);
}
let apiChain = Promise.resolve();       // les appels partent un par un (pas de double clic qui double un gain)
function api(action, params = {}, opts = {}) {
  const run = async () => {
    try {
      const { data, error } = await sb.functions.invoke("game", { body: { action, ...params } });
      if (error || !data) {
        if (!opts.silent) showToast("❌ Serveur indisponible, réessaie dans un instant.");
        return { ok: false, error: "network" };
      }
      applyServer(data);
      if (!data.ok && data.message && !opts.silent) showToast("❌ " + data.message);
      return data;
    } catch (e) {
      console.error(e);
      if (!opts.silent) showToast("❌ Serveur indisponible, réessaie dans un instant.");
      return { ok: false, error: "network" };
    }
  };
  const p = apiChain.then(run, run);
  apiChain = p.catch(() => {});
  return p;
}
function dailyAvailable() { return state.lastDaily !== todayKey(); }
function nextDailyStreak() { return state.lastDaily === todayKey(-1) ? (state.dailyStreak || 0) + 1 : 1; }
function dailyReward(streak) { return DAILY_BASE + DAILY_STREAK_STEP * Math.min(streak - 1, DAILY_STREAK_MAX); }
async function claimDaily() {
  if (blocked()) return;
  if (serverMode()) {
    const r = await api("claim_daily");
    if (r.ok) showToast(`🎁 Bonus quotidien : +🪙 ${r.result.gain} +💎 ${r.result.gems} (série de ${r.result.streak} jour${r.result.streak > 1 ? "s" : ""})`);
    return;
  }
  if (!dailyAvailable()) return showToast("⏳ Bonus déjà récupéré aujourd'hui, reviens demain !");
  const streak = nextDailyStreak();
  const gain = dailyReward(streak);
  state.coins += gain;
  state.gems += DAILY_GEMS;
  state.lastDaily = todayKey();
  state.dailyStreak = streak;
  saveState();
  showToast(`🎁 Bonus quotidien : +🪙 ${gain} +💎 ${DAILY_GEMS} (série de ${streak} jour${streak > 1 ? "s" : ""})`);
}
function updateDailyButton() {
  const btn = document.getElementById("btn-daily");
  if (!btn) return;
  if (dailyAvailable()) {
    btn.disabled = false;
    btn.textContent = `🎁 BONUS QUOTIDIEN • 🪙 ${dailyReward(nextDailyStreak())} + 💎 ${DAILY_GEMS}`;
  } else {
    btn.disabled = true;
    btn.textContent = `✅ BONUS RÉCUPÉRÉ • série ${state.dailyStreak || 1} j • demain 🪙 ${dailyReward((state.dailyStreak || 1) + 1)} + 💎 ${DAILY_GEMS}`;
  }
}
const SKIP_COST = 25;

// --- GRADATION : coût selon la rareté de la carte ---
const GRADE_COSTS = { C: 20, UC: 35, R: 60, UR: 120, SEC: 250 };

// Chaque carte existe en 12 versions : la carte normale + 11 notes
const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 9.5, 10];
const TOTAL_VERSIONS = GRADES.length + 1;
// Probabilité (en %) d'obtenir chaque note : le total fait 100
const GRADE_WEIGHTS = { 1: 4, 2: 5, 3: 7, 4: 9, 5: 12, 6: 14, 7: 14, 8: 12, 9: 10, 9.5: 8, 10: 5 };
const GRADE_LABELS = { 10: "GEM MINT", 9.5: "MINT", 9: "MINT", 8: "NM-MT", 7: "NM", 6: "EX-MT", 5: "EX", 4: "VG-EX", 3: "VG", 2: "GOOD", 1: "POOR" };

// --- SCORE & NIVEAU (identique au calcul fait côté base de données) ---
const RARITY_POINTS = { C: 1, UC: 2, R: 5, UR: 12, SEC: 30 };
const PAIR_POINTS = 2;        // par combinaison carte + note différente
const COMPLETE_BONUS = 20;    // par carte complète (normale + 11 notes)

const SLAB_DISPLAY_LIMIT = 60; // nombre de cartes gradées affichées dans la vitrine

// Valeur de recyclage d'une carte gradée = coût de gradation de sa rareté × ce coefficient (selon la note)
const GRADE_RECYCLE_FACTOR = { 1: 0.15, 2: 0.2, 3: 0.25, 4: 0.3, 5: 0.35, 6: 0.4, 7: 0.45, 8: 0.5, 9: 0.6, 9.5: 0.7, 10: 0.9 };

const CARD_BY_ID = Object.fromEntries(CARD_DATABASE.map(c => [c.id, c]));

// Fiche carte (agrandissement) : carte ouverte et version affichée
let detailCardId = null;
let detailVersion = "normal";

let state = loadState();

function loadState() {
  const saved = localStorage.getItem(SAVE_KEY);
  if (saved) return migrateState(JSON.parse(saved));
  return newGuestState();
}
function newGuestState() {
  return {
    coins: 600,
    gems: 100,
    packs: 2,
    edition: "E1",
    nextFreePackAt: Date.now() + FREE_PACK_INTERVAL_MS,
    collection: {}, // { "001": 3, ... }
    gradedCards: [] // [{ uid, cardId, grade, subgrades, isBlackLabel }]
  };
}

// Met à niveau les anciennes sauvegardes (édition, notes 8.5 supprimées)
function migrateState(s) {
  if (!s.edition) s.edition = "E1";
  s.collection = s.collection || {};
  s.gradedCards = s.gradedCards || [];
  s.gradedCards.forEach(g => {
    if (!GRADES.includes(g.grade)) g.grade = Math.max(1, Math.floor(g.grade));
  });
  return s;
}

function saveState() {
  if (!currentUser && typeof awardCompleteGems === "function") awardCompleteGems();   // mode invité uniquement
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  updateUI();
}

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.add("hidden"), 3000);
}

/* --- NAVIGATION --- */
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-section").forEach(s => s.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    updateUI();
    if (btn.dataset.tab === "leaderboard") loadLeaderboard();
  });
});

/* --- TIMER BOOSTER GRATUIT --- */
let timerCalledAt = 0;
setInterval(() => {
  const now = nowMs();
  if (now >= state.nextFreePackAt) {
    if (serverMode()) {
      if (Date.now() - timerCalledAt > 5000) {
        timerCalledAt = Date.now();
        api("free_pack", {}, { silent: true }).then(r => { if (r.ok && r.result && r.result.granted) showToast("🎁 Un booster gratuit vient d'arriver !"); });
      }
    } else if (!currentUser) {
      state.packs += 1;
      state.nextFreePackAt = now + FREE_PACK_INTERVAL_MS;
      saveState();
      showToast("🎁 Un booster gratuit vient d'arriver !");
    }
  }
  const remaining = Math.max(0, state.nextFreePackAt - now);
  const pct = 100 - (remaining / FREE_PACK_INTERVAL_MS) * 100;
  document.getElementById("timer-text").textContent = formatDuration(remaining);
  document.getElementById("timer-progress").style.width = `${pct}%`;
}, 1000);

function formatDuration(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
  const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
  const s = String(totalSec % 60).padStart(2, "0");
  return `${h}:${m}:${s}`;
}

/* --- TIRAGE ET OUVERTURE DE BOOSTER (1 PAR 1) --- */
function rollCard(minRarity = null, edition = state.edition) {
  // "ALL" = les 3 éditions classiques (l'édition spéciale Isekaz n'est jamais tirée ici)
  let pool = CARD_DATABASE.filter(c => edition === "ALL" ? !EDITIONS[c.edition].special : c.edition === edition);
  if (minRarity) pool = pool.filter(c => ["R", "UR", "SEC"].includes(c.rarity));

  const weighted = pool.map(card => ({ card, weight: RARITY_CONFIG[card.rarity].weight }));
  const totalWeight = weighted.reduce((acc, item) => acc + item.weight, 0);
  let rnd = Math.random() * totalWeight;
  for (const item of weighted) {
    if (rnd < item.weight) return item.card;
    rnd -= item.weight;
  }
  return pool[0];
}

// Carte exclusive du booster Isekaz : 3 % de « faite main », sinon l'une des 10 cartes de la série
function rollIsekazExclusive() {
  const series = CARD_DATABASE.filter(c => c.edition === "E4");
  const handmade = series.filter(c => c.handmade);
  const regular = series.filter(c => !c.handmade);
  const pool = (Math.random() < ISEKAZ_HANDMADE_CHANCE && handmade.length) ? handmade : regular;
  return pool[Math.floor(Math.random() * pool.length)];
}

function playRareEffect(slot, rarity) {
  const colors = { R: "#38bdf8", UR: "#c084fc", SEC: "#facc15" };
  const counts = { R: 12, UR: 22, SEC: 36 };
  const color = colors[rarity];

  const burst = document.createElement("div");
  burst.className = "reveal-burst";
  burst.style.setProperty("--c", color);

  for (let i = 0; i < counts[rarity]; i++) {
    const p = document.createElement("span");
    p.className = "reveal-particle";
    const angle = (Math.PI * 2 * i) / counts[rarity] + Math.random() * 0.4;
    const dist = 90 + Math.random() * 110;
    p.style.setProperty("--dx", `${Math.cos(angle) * dist}px`);
    p.style.setProperty("--dy", `${Math.sin(angle) * dist}px`);
    p.style.animationDelay = `${Math.random() * 0.1}s`;
    burst.appendChild(p);
  }

  slot.classList.add("bursting");
  slot.appendChild(burst);
  setTimeout(() => {
    burst.remove();
    slot.classList.remove("bursting");
  }, 1200);

  if (rarity === "UR" || rarity === "SEC") {
    const flash = document.createElement("div");
    flash.className = "screen-flash";
    flash.style.setProperty("--c", color);
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 700);
  }

  if (rarity === "SEC") {
    const content = document.querySelector("#pack-modal .modal-content");
    content.classList.remove("shake");
    void content.offsetWidth; // relance l'animation
    content.classList.add("shake");
  }
}

let isOpeningPack = false;

// Combien de boosters l'édition choisie peut-on ouvrir : déjà en stock, ou en achetant avec les pièces / diamants
function packsReady() { return state.edition === "E4" ? Math.floor(state.gems / ISEKAZ_COST) : state.packs; }
function packsAffordable() { return state.edition === "E4" ? Math.floor(state.gems / ISEKAZ_COST) : state.packs + Math.floor(state.coins / PACK_COST); }

async function openPack(count = 1, autoBuy = false) {
  if (isOpeningPack || blocked()) return;
  count = Math.min(10, Math.max(1, Math.floor(Number(count)) || 1));
  const isIsekaz = state.edition === "E4";
  if (isIsekaz) {
    if (state.gems < ISEKAZ_COST * count) return showToast(`❌ Il faut 💎 ${ISEKAZ_COST * count} pour ouvrir ${count > 1 ? count + " boosters Isekaz" : "un booster Isekaz"}.`);
  } else if (state.packs < count && !(autoBuy && packsAffordable() >= count)) {
    showToast(state.packs <= 0 && count === 1 ? "❌ Aucun booster disponible ! Achètes-en un ou attends le timer." : `❌ Il te faut ${count} boosters (tu en as ${state.packs}).`);
    return;
  }

  isOpeningPack = true;
  let pulled, discovery = 0;
  if (serverMode()) {
    // Le tirage est fait par le serveur ; le navigateur n'affiche que le résultat
    const r = await api("open_pack", { edition: state.edition, count, autoBuy });
    if (!r.ok) { isOpeningPack = false; return; }
    pulled = r.result.cards.map(id => CARD_BY_ID[id]).filter(Boolean);
    discovery = r.result.discovery || 0;
    pulled.forEach(c => { if (c.image) new Image().src = c.image; });
  } else {
    pulled = [];
    for (let n = 0; n < count; n++) {
      if (isIsekaz) {
        state.gems -= ISEKAZ_COST;
        // 9 cartes tirées dans les 3 éditions + 1 carte exclusive Isekaz en dernière position
        for (let i = 0; i < ISEKAZ_CARDS - 1; i++) pulled.push(rollCard(null, "ALL"));
        pulled.push(rollIsekazExclusive());
      } else {
        if (state.packs <= 0) { state.coins -= PACK_COST; state.packs += 1; }   // achat automatique du booster manquant
        state.packs -= 1;
        // 4 cartes aléatoires + 1 carte garantie Rare minimum en dernière position
        pulled.push(rollCard(), rollCard(), rollCard(), rollCard(), rollCard("R"));
      }
    }
  }
  // Précharge les illustrations pour qu'elles soient prêtes au retournement
  if (!serverMode()) {
    pulled.forEach(c => { if (c.image) new Image().src = c.image; });
    pulled.forEach(c => {
      if (!state.collection[c.id] && !state.gradedCards.some(g => g.cardId === c.id)) discovery += DISCOVERY_BONUS[c.rarity] || 0;
      state.collection[c.id] = (state.collection[c.id] || 0) + 1;
    });
    if (discovery > 0) state.coins += discovery;
    saveState();
  }
  if (discovery > 0) setTimeout(() => showToast(`🆕 Nouvelles cartes découvertes : +🪙 ${discovery}`), 3500);

  // Ouverture interactive : on déchire le booster à la main, puis les cartes se dévoilent une par une
  isOpeningPack = false;
  const modal = document.getElementById("pack-modal");
  const container = document.getElementById("opened-cards-container");
  const closeBtn = document.getElementById("btn-close-modal");
  const hint = modal.querySelector(".modal-hint");
  const title = modal.querySelector("h2");

  closeBtn.classList.add("hidden");
  let againBtn = document.getElementById("btn-open-again");
  if (!againBtn) {
    againBtn = document.createElement("button");
    againBtn.id = "btn-open-again";
    againBtn.className = "btn-secondary";
    closeBtn.parentNode.insertBefore(againBtn, closeBtn);
    againBtn.addEventListener("click", () => openPack(1, true));
  }
  againBtn.classList.add("hidden");
  // « Ouvrir un autre booster » : en stock, sinon acheté avec les pièces, ou payé en diamants pour Isekaz
  const showClose = () => {
    closeBtn.classList.remove("hidden");
    if (packsReady() >= 1) {
      againBtn.textContent = isIsekaz ? `OUVRIR UN AUTRE (💎 ${ISEKAZ_COST})` : `OUVRIR UN AUTRE (${state.packs} en stock)`;
      againBtn.classList.remove("hidden");
    } else if (packsAffordable() >= 1) {
      againBtn.textContent = `ACHETER ET OUVRIR (🪙 ${PACK_COST})`;
      againBtn.classList.remove("hidden");
    }
  };
  container.classList.add("hidden");
  container.innerHTML = "";
  const oldStage = document.getElementById("opening-stage");
  if (oldStage) oldStage.remove();
  const stage = document.createElement("div");
  stage.id = "opening-stage";
  container.parentNode.insertBefore(stage, container);

  let revealAllBtn = document.getElementById("btn-reveal-all");
  if (!revealAllBtn) {
    revealAllBtn = document.createElement("button");
    revealAllBtn.id = "btn-reveal-all";
    revealAllBtn.className = "btn-secondary";
    closeBtn.parentNode.insertBefore(revealAllBtn, closeBtn);
  }
  revealAllBtn.classList.add("hidden");

  // Plusieurs boosters : on les enchaîne un par un (déchirage + cartes), sans fermer la fenêtre
  const packSize = isIsekaz ? ISEKAZ_CARDS : 5;
  const packsList = [];
  for (let i = 0; i < pulled.length; i += packSize) packsList.push(pulled.slice(i, i + packSize));
  let packIdx = 0, cur = packsList[0];
  const multi = packsList.length > 1;
  const packTitle = base => multi ? `${base} • ${packIdx + 1}/${packsList.length}` : base;
  const SUSPENSE = { R: 500, UR: 900, SEC: 1400 };
  const slotHTML = (card, idx, faceUp) => `
    <div class="flip-slot${faceUp ? "" : ""}" data-rarity="${card.rarity}" data-index="${idx}">
      <div class="flip-inner">
        <div class="flip-back">
          <div class="flip-back-emblem">✦</div>
          <div class="flip-back-label">Carte ${idx + 1}/${cur.length}</div>
        </div>
        <div class="flip-front">${renderCardHTML(card)}</div>
      </div>
    </div>`;

  /* ---------- Récapitulatif : toutes les cartes du booster ---------- */
  const showRecap = () => {
    stage.remove();
    title.textContent = multi ? `CONTENU DES ${packsList.length} BOOSTERS` : "CONTENU DU BOOSTER";
    hint.textContent = "Survole les cartes pour admirer les reflets holographiques !";
    revealAllBtn.classList.add("hidden");
    closeBtn.classList.add("hidden");
    container.classList.remove("hidden");
    container.innerHTML = pulled.map((c, i) => slotHTML(c, i)).join("");
    const slots = container.querySelectorAll(".flip-slot");
    const gap = Math.min(140, Math.floor(2400 / slots.length));
    slots.forEach((slot, i) => setTimeout(() => {
      slot.classList.add("flipped");
      if (i === slots.length - 1) setTimeout(showClose, 450);
    }, 250 + i * gap));
  };

  /* ---------- Phase 2 : les cartes une par une (dos à gauche, carte dévoilée à droite) ---------- */
  const startSequence = () => {
    title.textContent = packTitle("TON BOOSTER");
    hint.textContent = "Clique sur la carte de gauche pour la dévoiler !";
    stage.innerHTML = `
      <div class="seq-stage">
        <div class="seq-col seq-left">${slotHTML(cur[0], 0).replace('class="flip-slot"', 'class="flip-slot seq-slot"')}</div>
        <div class="seq-arrow">➜</div>
        <div class="seq-col seq-right"><div class="seq-placeholder">?</div></div>
      </div>
      <div class="seq-history"></div>`;
    const left = stage.querySelector(".seq-left .flip-slot");
    left.querySelector(".flip-front").remove();
    const right = stage.querySelector(".seq-right");
    const history = stage.querySelector(".seq-history");
    revealAllBtn.textContent = multi ? "TOUT RÉVÉLER (TOUS LES BOOSTERS)" : "TOUT RÉVÉLER";
    revealAllBtn.classList.remove("hidden");
    revealAllBtn.onclick = showRecap;

    const addThumb = card => {
      const t = document.createElement("div");
      t.className = "seq-thumb";
      t.dataset.rarity = card.rarity;
      t.title = card.name;
      if (card.image) t.style.backgroundImage = `url('${card.image}')`;
      else { t.style.background = card.bg; t.textContent = card.emoji; }
      history.appendChild(t);
    };

    let idx = 0, busy = false;
    const step = () => {
      if (busy || idx >= cur.length) return;
      busy = true;
      const card = cur[idx];
      const go = () => {
        left.classList.remove("charging");
        if (idx > 0) addThumb(cur[idx - 1]);
        right.innerHTML = slotHTML(card, idx);
        const slot = right.querySelector(".flip-slot");
        slot.classList.add("seq-slot");
        requestAnimationFrame(() => requestAnimationFrame(() => {
          slot.classList.add("flipped");
          if (SUSPENSE[card.rarity]) playRareEffect(slot, card.rarity);
        }));
        if (card.rarity === "SEC") showToast("🌟 CARTE SECRÈTE DÉBLOQUÉE !");
        else if (card.rarity === "UR") showToast("🔥 ULTRA RARE !");
        idx++;
        if (idx < cur.length) {
          left.dataset.rarity = cur[idx].rarity;
          left.querySelector(".flip-back-label").textContent = `Carte ${idx + 1}/${cur.length}`;
          left.style.animation = "none"; void left.offsetWidth; left.style.animation = "";
          hint.textContent = `Carte suivante : clique à gauche (${idx + 1}/${cur.length})`;
          busy = false;
        } else {
          left.classList.add("seq-done");
          hint.textContent = "Survole la carte pour admirer les reflets holographiques !";
          if (packIdx < packsList.length - 1) {
            // Booster suivant : on enchaîne directement
            const nextBtn = document.createElement("button");
            nextBtn.className = "btn-primary";
            nextBtn.id = "btn-next-pack";
            nextBtn.textContent = `BOOSTER SUIVANT (${packIdx + 2}/${packsList.length}) ➜`;
            nextBtn.addEventListener("click", () => { packIdx++; cur = packsList[packIdx]; startTear(); });
            stage.appendChild(nextBtn);
            nextBtn.focus();
          } else {
            revealAllBtn.textContent = multi ? "VOIR TOUTES LES CARTES DES BOOSTERS" : "VOIR TOUTES LES CARTES";
            showClose();
          }
          busy = false;
        }
      };
      if (SUSPENSE[card.rarity]) {
        left.classList.add("charging");
        setTimeout(go, SUSPENSE[card.rarity]);
      } else go();
    };
    left.addEventListener("click", step);
  };

  /* ---------- Phase 1 : déchirer le haut du booster en traçant la ligne pointillée ---------- */
  const startTear = () => {
    const src = document.getElementById("booster-pack");
    const TOP = 14; // position de la ligne de coupe (% de la hauteur)
    const clone = cls => {
      const c = src.cloneNode(true);
      c.removeAttribute("id");
      c.className = `${src.className} tear-clone ${cls}`;
      c.style.cssText = src.style.cssText;
      c.querySelectorAll(".booster-counter").forEach(n => n.remove());
      return c.outerHTML;
    };
    title.textContent = packTitle("DÉCHIRE LE BOOSTER");
    hint.textContent = "Trace la ligne pointillée de gauche à droite avec ta souris ou ton doigt.";
    stage.innerHTML = `
      <div class="tear-stage">
        <div class="tear-pack" tabindex="0" role="button" aria-label="Déchirer le booster (Entrée pour ouvrir)" style="--top:${TOP}%">
          ${clone("tear-bottom")}
          <div class="tear-glow"></div>
          <div class="tear-topwrap">${clone("tear-attached")}${clone("tear-torn")}</div>
          <div class="tear-line"></div>
          <div class="tear-dot">✂</div>
        </div>
        <button class="btn-secondary" id="btn-skip-tear">OUVRIR DIRECTEMENT</button>
      </div>`;
    const pack = stage.querySelector(".tear-pack");
    const attached = pack.querySelector(".tear-attached");
    const torn = pack.querySelector(".tear-torn");
    const glow = pack.querySelector(".tear-glow");
    const dot = pack.querySelector(".tear-dot");
    let progress = 0, dragging = false, finished = false;

    const paint = () => {
      const x = (progress * 100).toFixed(1);
      attached.style.clipPath = `inset(0 0 ${100 - TOP}% ${x}%)`;
      torn.style.clipPath = `inset(0 ${100 - x}% ${100 - TOP}% 0)`;
      torn.style.transformOrigin = `${x}% ${TOP}%`;
      glow.style.width = `${x}%`;
      dot.style.left = `${x}%`;
      pack.classList.toggle("started", progress > 0.02);
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      progress = 1; paint();
      pack.classList.add("done");
      setTimeout(startSequence, 850);
    };
    const move = e => {
      const r = pack.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width;
      const fy = (e.clientY - r.top) / r.height;
      // Il faut rester près de la ligne de coupe et ne pas « sauter » trop loin
      if (Math.abs(fy - TOP / 100) < 0.16 && fx <= progress + 0.3) {
        if (fx > progress) { progress = Math.min(1, fx); paint(); }
        if (progress >= 0.96) finish();
      }
    };
    pack.addEventListener("pointerdown", e => {
      if (finished) return;
      dragging = true;
      try { pack.setPointerCapture(e.pointerId); } catch (_) {}
      move(e);
      e.preventDefault();
    });
    pack.addEventListener("pointermove", e => { if (dragging && !finished) move(e); });
    const stop = () => { dragging = false; };
    pack.addEventListener("pointerup", stop);
    pack.addEventListener("pointercancel", stop);
    pack.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); finish(); } });
    stage.querySelector("#btn-skip-tear").addEventListener("click", finish);
    paint();
  };

  modal.classList.remove("hidden");
  startTear();
}

document.getElementById("btn-open-pack").addEventListener("click", () => openPack());
document.getElementById("booster-pack").addEventListener("click", () => openPack());
document.getElementById("multi-open").addEventListener("click", e => {
  const b = e.target.closest("[data-multi]");
  if (b) openPack(Number(b.dataset.multi), true);
});
function updateMultiButtons() {
  document.querySelectorAll("#multi-open [data-multi]").forEach(b => {
    const n = Number(b.dataset.multi);
    const cost = state.edition === "E4" ? `💎 ${ISEKAZ_COST * n}` : (state.packs >= n ? `${n} en stock` : `🪙 ${(n - state.packs) * PACK_COST} à acheter`);
    b.textContent = `OUVRIR ×${n} (${cost})`;
    b.disabled = packsAffordable() < n;
  });
}
document.getElementById("btn-close-modal").addEventListener("click", () => {
  document.getElementById("pack-modal").classList.add("hidden");
});

document.getElementById("btn-buy-pack").addEventListener("click", async () => {
  if (blocked()) return;
  if (serverMode()) { const r = await api("buy_pack"); if (r.ok) showToast("🛒 +1 Booster ajouté à ton inventaire !"); return; }
  if (state.coins < PACK_COST) return showToast("❌ Pas assez de pièces !");
  state.coins -= PACK_COST;
  state.packs += 1;
  saveState();
  showToast("🛒 +1 Booster ajouté à ton inventaire !");
});

document.getElementById("btn-daily").addEventListener("click", claimDaily);
document.getElementById("btn-skip-timer").addEventListener("click", async () => {
  if (blocked()) return;
  if (serverMode()) { const r = await api("skip_timer"); if (r.ok) showToast("⚡ Booster instantané récupéré !"); return; }
  if (state.gems < SKIP_COST) return showToast("❌ Pas assez de gemmes !");
  state.gems -= SKIP_COST;
  state.packs += 1;
  state.nextFreePackAt = Date.now() + FREE_PACK_INTERVAL_MS;
  saveState();
  showToast("⚡ Booster instantané récupéré !");
});

/* --- SYSTÈME DE GRADATION --- */
function rollGrade() {
  let r = Math.random() * 100;
  for (const g of GRADES) {
    r -= GRADE_WEIGHTS[g];
    if (r < 0) return g;
  }
  return 10;
}

function getGradeCost(cardId) {
  const card = CARD_BY_ID[cardId];
  return card ? GRADE_COSTS[card.rarity] : 0;
}

function updateGradeButton() {
  const id = document.getElementById("grading-select").value;
  const cost = id ? getGradeCost(id) : 0;
  document.getElementById("btn-grade-card").textContent =
    cost ? `LANCER L'EXPERTISE (🪙 ${cost})` : "LANCER L'EXPERTISE";
}

document.getElementById("grading-select").addEventListener("change", updateGradeButton);

document.getElementById("btn-grade-card").addEventListener("click", async () => {
  if (blocked()) return;
  const cardId = document.getElementById("grading-select").value;
  if (!cardId || !state.collection[cardId]) return showToast("❌ Sélectionne une carte valide.");
  if (serverMode()) {
    const r = await api("grade", { cardId });
    if (r.ok) showGradeResult(r.result.slab, r.result.isNew, r.result.allGrades, r.result.hasNormal);
    return;
  }
  const cost = getGradeCost(cardId);
  if (state.coins < cost) return showToast(`❌ Il faut ${cost} pièces pour grader cette carte.`);

  const alreadyHad = new Set(state.gradedCards.filter(g => g.cardId === cardId).map(g => g.grade));

  state.coins -= cost;
  state.collection[cardId] -= 1;
  if (state.collection[cardId] <= 0) delete state.collection[cardId];

  const grade = rollGrade();
  const isBlackLabel = grade === 10 && Math.random() > 0.7;
  const bump = chance => Math.min(10, grade + (Math.random() < chance ? 0.5 : 0));
  const subgrades = {
    centering: isBlackLabel ? 10 : bump(0.5),
    corners:   isBlackLabel ? 10 : grade,
    edges:     isBlackLabel ? 10 : bump(0.4),
    surface:   isBlackLabel ? 10 : grade
  };

  const gradedObj = {
    uid: `SLAB-${Date.now().toString(36).slice(-4).toUpperCase()}${Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, "0")}`,
    cardId,
    grade,
    subgrades,
    isBlackLabel
  };

  state.gradedCards.unshift(gradedObj);
  saveState();
  showGradeResult(gradedObj, !alreadyHad.has(grade), new Set([...alreadyHad, grade]).size === GRADES.length, (state.collection[cardId] || 0) > 0);
});

function showGradeResult(gradedObj, isNew, allGrades, hasNormal) {
  const grade = gradedObj.grade, isBlackLabel = gradedObj.isBlackLabel;
  document.getElementById("grading-result-zone").innerHTML = renderSlabHTML(gradedObj);
  if (allGrades && hasNormal) showToast("🏆 CARTE COMPLÈTE ! Cadre doré débloqué !");
  else if (allGrades) showToast("✅ 11/11 notes ! Il te faut encore un exemplaire normal pour compléter la carte.");
  else if (isBlackLabel) showToast("🌟 INCROYABLE ! BLACK LABEL 10 !");
  else if (isNew) showToast(`🆕 Nouvelle note : ${grade}/10 !`);
  else showToast(`Note ${grade}/10 déjà possédée pour cette carte.`);
}

/* --- RECYCLAGE --- */
async function recycleCard(cardId, count = 1, dupsOnly = false) {
  if (blocked()) return;
  if (serverMode()) {
    const r = await api("recycle", { kind: "normal", cardId, count, dupsOnly });
    if (r.ok) showToast(`♻️ +${r.result.gain} pièces récupérées !`);
    return;
  }
  const card = CARD_BY_ID[cardId];
  if (!card || (state.collection[cardId] || 0) < count) return;
  state.collection[cardId] -= count;
  if (state.collection[cardId] <= 0) delete state.collection[cardId];
  const gain = RARITY_CONFIG[card.rarity].recycleValue * count;
  state.coins += gain;
  saveState();
  showToast(`♻️ +${gain} pièces récupérées !`);
}

document.getElementById("btn-recycle-all").addEventListener("click", async () => {
  if (blocked()) return;
  if (serverMode()) {
    const r = await api("recycle", { kind: "all_normal" });
    if (r.ok) showToast(`♻️ Tous les doublons recyclés : +${r.result.gain} pièces !`);
    return;
  }
  let totalGain = 0;
  for (const [id, qty] of Object.entries(state.collection)) {
    if (qty > 1) {
      const extra = qty - 1;
      const card = CARD_DATABASE.find(c => c.id === id);
      totalGain += extra * RARITY_CONFIG[card.rarity].recycleValue;
      state.collection[id] = 1;
    }
  }
  if (totalGain === 0) return showToast("Aucun doublon à recycler !");
  state.coins += totalGain;
  saveState();
  showToast(`♻️ Tous les doublons recyclés : +${totalGain} pièces !`);
});

/* --- RENDU VISUEL DES CARTES & SLABS --- */
function renderCardHTML(card, opts = {}) {
  // Carte non possédée : l'illustration reste cachée (point d'interrogation)
  const showArt = card.image && !opts.locked;
  const artStyle = showArt
    ? `background-image: url('${card.image}')`
    : `background: ${card.bg}`;
  const artContent = showArt ? "" : (opts.locked ? "?" : card.emoji);

  return `
    <div class="tcg-card rarity-${card.rarity} ${opts.locked ? "locked" : ""} ${opts.complete ? "complete" : ""} ${card.series ? "series-isekaz" : ""} ${card.handmade ? "handmade" : ""} ${opts.clickable ? "clickable" : ""}" data-card-id="${card.id}">
      <div class="holo-overlay"></div>
      <div class="card-header">
        <span>#${card.id}</span>
        <span>${card.rarity}${card.series ? " ✦ ISEKAZ" : ""}${opts.complete ? " ★ 100 %" : ""}</span>
      </div>
      <div class="card-art" style="${artStyle}">${artContent}</div>
      <div class="card-name">${opts.locked ? "???" : card.name}</div>
      <div class="card-meta">
        <span>${RARITY_CONFIG[card.rarity].label}</span>
        <span>${opts.countText || ""}</span>
      </div>
      ${opts.extraHTML || ""}
    </div>
  `;
}

// Vitrine : une seule vignette par carte gradée (meilleure note), clic = fiche détaillée
function renderGradedShowcase() {
  const byCard = {};
  for (const s of state.gradedCards) {
    (byCard[s.cardId] = byCard[s.cardId] || []).push(s);
  }
  const entries = Object.keys(byCard).filter(id => CARD_BY_ID[id]).map(id => {
    const slabs = byCard[id];
    const grades = new Set(slabs.map(s => s.grade));
    const best = slabs.reduce((m, s) => (s.grade > m.grade || (s.grade === m.grade && slabQuality(s) > slabQuality(m))) ? s : m, slabs[0]);
    const complete = grades.size === GRADES.length && (state.collection[id] || 0) > 0;
    return { id, slabs, count: grades.size, best, complete };
  });
  entries.sort((a, b) => (b.complete - a.complete) || (b.count - a.count) || a.id.localeCompare(b.id));
  return entries.map(en => {
    const card = CARD_BY_ID[en.id];
    return `
      <div class="slab-wrapper clickable showcase${en.complete ? " complete" : ""}" data-card-id="${en.id}" data-grade="${en.best.grade}">
        <div class="slab-label ${en.best.isBlackLabel ? "black-label" : ""}">
          <div class="slab-info">
            <strong>${card.name}</strong>
            <span>${en.count}/${GRADES.length} notes${en.complete ? " ★ COMPLÈTE" : ""}</span>
          </div>
          <div class="slab-grade" title="Meilleure note">${en.best.grade}</div>
        </div>
        ${renderCardHTML(card, { complete: en.complete })}
        <div class="slab-subgrades">${en.slabs.length} exemplaire${en.slabs.length > 1 ? "s" : ""} gradé${en.slabs.length > 1 ? "s" : ""} • touche pour voir le détail</div>
      </div>`;
  }).join("");
}

function renderSlabHTML(slab, opts = {}) {
  const card = CARD_BY_ID[slab.cardId];
  const labelTitle = slab.isBlackLabel ? "BLACK LABEL 10" : (GRADE_LABELS[slab.grade] || "GRADED");
  return `
    <div class="slab-wrapper ${opts.clickable ? "clickable" : ""}" data-card-id="${slab.cardId}" data-grade="${slab.grade}">
      <div class="slab-label ${slab.isBlackLabel ? "black-label" : ""}">
        <div class="slab-info">
          <strong>${card.name}</strong>
          <span>${labelTitle} • ${slab.uid}</span>
        </div>
        <div class="slab-grade">${slab.grade}</div>
      </div>
      ${renderCardHTML(card)}
      <div class="slab-subgrades">
        C:${slab.subgrades.centering} | CO:${slab.subgrades.corners} | B:${slab.subgrades.edges} | S:${slab.subgrades.surface}
      </div>
      ${opts.dupValue ? `<button class="recycle-btn slab-recycle" data-uid="${slab.uid}">Doublon : recycler (+🪙 ${opts.dupValue})</button>` : ""}
    </div>
  `;
}

/* --- DOUBLONS GRADÉS & FICHE CARTE --- */
function slabQuality(slab) {
  const sg = slab.subgrades || {};
  return (slab.isBlackLabel ? 100 : 0) + (sg.centering || 0) + (sg.corners || 0) + (sg.edges || 0) + (sg.surface || 0);
}

// Regroupe les cartes gradées par carte + note ; la meilleure est conservée en premier
function getSlabGroups() {
  const groups = {};
  for (const s of state.gradedCards) {
    const key = `${s.cardId}|${s.grade}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  }
  for (const key in groups) groups[key].sort((a, b) => slabQuality(b) - slabQuality(a));
  return groups;
}

// Doublons = tout sauf la meilleure carte de chaque combinaison carte + note
function getDuplicateSlabs(groups = getSlabGroups()) {
  return Object.values(groups).flatMap(list => list.slice(1));
}

function slabRecycleValue(slab) {
  const card = CARD_BY_ID[slab.cardId];
  if (!card) return 0;
  return Math.max(1, Math.round(GRADE_COSTS[card.rarity] * (GRADE_RECYCLE_FACTOR[slab.grade] || 0.2)));
}

async function recycleSlabs(list, filter = {}) {
  if (!list.length || blocked()) return;
  if (serverMode()) {
    const r = await api("recycle", { kind: "slabs", ...filter });
    if (r.ok) { const n = r.result.count; showToast(`♻️ ${n} carte${n > 1 ? "s" : ""} gradée${n > 1 ? "s" : ""} recyclée${n > 1 ? "s" : ""} : +${r.result.gain} pièces !`); }
    return;
  }
  const gain = list.reduce((n, s) => n + slabRecycleValue(s), 0);
  const toRemove = new Set(list);
  state.gradedCards = state.gradedCards.filter(s => !toRemove.has(s));
  state.coins += gain;
  saveState();
  const n = list.length;
  showToast(`♻️ ${n} carte${n > 1 ? "s" : ""} gradée${n > 1 ? "s" : ""} recyclée${n > 1 ? "s" : ""} : +${gain} pièces !`);
}

function updateRecycleSlabsButton(dups) {
  const btn = document.getElementById("btn-recycle-slabs");
  if (!btn) return;
  const total = dups.reduce((n, s) => n + slabRecycleValue(s), 0);
  btn.disabled = dups.length === 0;
  btn.textContent = dups.length
    ? `RECYCLER ${dups.length} DOUBLON${dups.length > 1 ? "S" : ""} GRADÉ${dups.length > 1 ? "S" : ""} (🪙 +${total})`
    : "AUCUN DOUBLON GRADÉ";
}

function openCardDetail(cardId, version = "normal") {
  if (!CARD_BY_ID[cardId]) return;
  detailCardId = cardId;
  detailVersion = version;
  renderCardDetail();
  document.getElementById("card-modal").classList.remove("hidden");
  document.getElementById("btn-close-card-modal").focus();
}

function closeCardDetail() {
  detailCardId = null;
  document.getElementById("card-modal").classList.add("hidden");
}

function renderCardDetail() {
  const card = CARD_BY_ID[detailCardId];
  if (!card) return closeCardDetail();

  const qty = state.collection[card.id] || 0;
  const groups = getSlabGroups();
  const normalDup = Math.max(0, qty - 1);
  const normalValue = normalDup * RARITY_CONFIG[card.rarity].recycleValue;
  const gradeData = GRADES.map(g => {
    const list = groups[`${card.id}|${g}`] || [];
    return { grade: g, count: list.length, best: list[0], dups: list.slice(1) };
  });
  const gradesOwned = gradeData.filter(x => x.count > 0).length;
  const versions = (qty > 0 ? 1 : 0) + gradesOwned;
  const complete = qty > 0 && gradesOwned === GRADES.length;
  const slabDupValue = gradeData.reduce((n, x) => n + x.dups.reduce((m, s) => m + slabRecycleValue(s), 0), 0);
  const slabDupCount = gradeData.reduce((n, x) => n + x.dups.length, 0);
  const totalValue = normalValue + slabDupValue;
  const totalDup = normalDup + slabDupCount;

  // Aperçu en grand : carte normale ou carte gradée sélectionnée
  const selected = detailVersion === "normal" ? null : gradeData.find(x => x.grade === detailVersion && x.best);
  if (!selected) detailVersion = "normal";
  document.getElementById("card-detail-preview").innerHTML = selected
    ? renderSlabHTML(selected.best)
    : renderCardHTML(card, { complete, countText: qty > 0 ? `×${qty}` : "" });

  const tile = (version, label, count, dupCount, dupValue) => {
    const owned = count > 0;
    const isSelected = String(detailVersion) === String(version);
    return `
      <div class="version-tile ${owned ? "owned" : "missing"} ${isSelected ? "selected" : ""}" data-version="${version}" ${owned ? 'tabindex="0" role="button"' : ""}>
        <span class="vt-grade">${label}</span>
        <span class="vt-count">${owned ? `×${count}` : "—"}</span>
        ${dupCount > 0 ? `<button class="vt-recycle" data-recycle="${version}">♻ ${dupCount} (+${dupValue})</button>` : ""}
      </div>`;
  };

  const tiles = tile("normal", "Normale", qty, normalDup, normalValue) + gradeData.map(x =>
    tile(x.grade, x.grade, x.count, x.dups.length, x.dups.reduce((n, s) => n + slabRecycleValue(s), 0))
  ).join("");

  const pct = Math.round((versions / TOTAL_VERSIONS) * 100);
  const edition = EDITIONS[card.edition] ? EDITIONS[card.edition].name : "";
  document.getElementById("card-detail-info").innerHTML = `
    <h2>${escapeHTML(card.name)}</h2>
    <p class="card-detail-meta">#${card.id} • ${RARITY_CONFIG[card.rarity].label}${edition ? ` • ${escapeHTML(edition)}` : ""}</p>
    ${complete ? `<p class="complete-note">★ Carte complète : 100 % collectée</p>` : ""}
    <div class="card-progress">
      <div class="card-progress-bar"><div style="width:${pct}%"></div></div>
      <span>${versions}/${TOTAL_VERSIONS}</span>
    </div>
    <h3>Versions possédées</h3>
    <div class="version-grid">${tiles}</div>
    <p class="detail-help">Clique sur une version pour la voir en grand. Un exemplaire de chaque version est conservé : seuls les doublons se recyclent, à un prix qui dépend de la note.</p>
    <button id="btn-detail-recycle-all" class="btn-secondary" ${totalDup ? "" : "disabled"}>
      ${totalDup ? `Recycler tous les doublons de cette carte (🪙 +${totalValue})` : "Aucun doublon à recycler"}
    </button>
  `;
}

document.getElementById("card-modal").addEventListener("click", e => {
  if (e.target.id === "card-modal" || e.target.closest("#btn-close-card-modal")) return closeCardDetail();

  const recycleBtn = e.target.closest("[data-recycle]");
  if (recycleBtn) {
    const kind = recycleBtn.dataset.recycle;
    if (kind === "normal") {
      recycleCard(detailCardId, Math.max(0, (state.collection[detailCardId] || 0) - 1), true);
    } else {
      recycleSlabs(getDuplicateSlabs().filter(s => s.cardId === detailCardId && s.grade === Number(kind)), { cardId: detailCardId, grade: Number(kind) });
    }
    return;
  }

  if (e.target.closest("#btn-detail-recycle-all")) {
    const normalDup = Math.max(0, (state.collection[detailCardId] || 0) - 1);
    const card = CARD_BY_ID[detailCardId];
    const slabDups = getDuplicateSlabs().filter(s => s.cardId === detailCardId);
    const total = normalDup * RARITY_CONFIG[card.rarity].recycleValue + slabDups.reduce((n, s) => n + slabRecycleValue(s), 0);
    if (total <= 0) return;
    if (!confirm(`Recycler tous les doublons de « ${card.name} » pour +${total} pièces ?\nUn exemplaire de chaque version est conservé.`)) return;
    if (blocked()) return;
    if (serverMode()) {
      api("recycle", { kind: "card_all", cardId: detailCardId }).then(r => { if (r.ok) showToast(`♻️ Doublons recyclés : +${r.result.gain} pièces !`); });
      return;
    }
    if (normalDup > 0) {
      state.collection[detailCardId] -= normalDup;
      state.coins += normalDup * RARITY_CONFIG[card.rarity].recycleValue;
    }
    if (slabDups.length) {
      const toRemove = new Set(slabDups);
      state.gradedCards = state.gradedCards.filter(s => !toRemove.has(s));
      state.coins += slabDups.reduce((n, s) => n + slabRecycleValue(s), 0);
    }
    saveState();
    showToast(`♻️ Doublons recyclés : +${total} pièces !`);
    return;
  }

  const tile = e.target.closest(".version-tile");
  if (tile && !tile.classList.contains("missing")) {
    detailVersion = tile.dataset.version === "normal" ? "normal" : Number(tile.dataset.version);
    renderCardDetail();
  }
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape" && detailCardId) closeCardDetail();
});

// Clic sur une carte de la collection : ouvre la fiche
document.getElementById("collection-grid").addEventListener("click", e => {
  const el = e.target.closest(".tcg-card");
  if (!el) return;
  const id = el.dataset.cardId;
  const owned = (state.collection[id] || 0) > 0 || state.gradedCards.some(g => g.cardId === id);
  if (!owned) return showToast("Tu n'as pas encore cette carte.");
  openCardDetail(id);
});

// Clic sur une carte gradée : ouvre la fiche à cette note ; bouton pour recycler un doublon
document.getElementById("graded-grid").addEventListener("click", e => {
  const wrap = e.target.closest(".slab-wrapper");
  if (wrap) openCardDetail(wrap.dataset.cardId, Number(wrap.dataset.grade));
});

// Onglet Recyclage : tous les doublons gradés d'un coup
document.getElementById("btn-recycle-slabs").addEventListener("click", () => {
  const dups = getDuplicateSlabs();
  if (!dups.length) return showToast("Aucun doublon gradé à recycler !");
  const total = dups.reduce((n, s) => n + slabRecycleValue(s), 0);
  if (!confirm(`Recycler ${dups.length} carte${dups.length > 1 ? "s" : ""} gradée${dups.length > 1 ? "s" : ""} en double pour +${total} pièces ?\nUne carte de chaque note est conservée.`)) return;
  recycleSlabs(dups);
});

/* --- EFFET HOLOGRAPHIQUE (un seul écouteur pour toutes les cartes) --- */
document.addEventListener("mousemove", e => {
  const card = e.target.closest && e.target.closest(".tcg-card");
  if (!card) return;
  const rect = card.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 100;
  const y = ((e.clientY - rect.top) / rect.height) * 100;
  card.style.setProperty("--mx", `${x}%`);
  card.style.setProperty("--my", `${y}%`);
  const rotY = ((x - 50) / 50) * 10;
  const rotX = ((50 - y) / 50) * 10;
  card.style.transform = `perspective(600px) rotateX(${rotX}deg) rotateY(${rotY}deg)`;
});

document.addEventListener("mouseout", e => {
  const card = e.target.closest && e.target.closest(".tcg-card");
  if (card && !card.contains(e.relatedTarget)) {
    card.style.transform = "perspective(600px) rotateX(0) rotateY(0)";
  }
});

/* --- SÉLECTEUR D'ÉDITION --- */
function renderEditionPicker() {
  if (!EDITIONS[state.edition]) state.edition = "E1";

  const picker = document.getElementById("edition-picker");
  picker.innerHTML = Object.entries(EDITIONS).map(([id, ed]) =>
    `<button class="edition-btn ${state.edition === id ? "active" : ""}" data-ed="${id}">${ed.tag}</button>`
  ).join("");

  const ed = EDITIONS[state.edition];
  const pack = document.getElementById("booster-pack");
  pack.querySelector(".booster-tag").textContent = ed.tag;
  pack.querySelector(".booster-art h2").textContent = ed.name;
  pack.setAttribute("aria-label", `Booster ${ed.name}`);

  // Booster spécial (diamants) : textes et boutons adaptés
  const special = !!ed.special;
  pack.querySelector(".booster-art p").textContent = special ? `${ISEKAZ_CARDS} CARTES • 1 EXCLUSIVE` : "5 CARTES • 1 RARE MIN.";
  document.querySelector(".pack-info").textContent = special
    ? `${ISEKAZ_CARDS} cartes des 3 éditions • 1 carte exclusive Isekaz (3 % de faite main)`
    : "5 cartes • 1 rare minimum";
  pack.querySelector(".booster-counter").classList.toggle("hidden", special);
  document.getElementById("btn-buy-pack").classList.toggle("hidden", special);
  document.getElementById("btn-open-pack").textContent = special ? `OUVRIR (💎 ${ISEKAZ_COST})` : "OUVRIR UN BOOSTER";

  if (ed.pack) {
    // Paquet illustré : l'image remplace le dégradé et les textes
    pack.classList.add("has-art");
    pack.style.background = "";
    pack.style.backgroundImage = `url('${ed.pack}')`;
  } else {
    pack.classList.remove("has-art");
    pack.style.backgroundImage = "";
    pack.style.background = ed.gradient;
  }

  // Précharge toutes les illustrations de paquets une seule fois
  if (!renderEditionPicker.preloaded) {
    Object.values(EDITIONS).forEach(e => { if (e.pack) new Image().src = e.pack; });
    renderEditionPicker.preloaded = true;
    new Image().src = "assets/cards/back.webp?v=40";
  }
}

document.getElementById("edition-picker").addEventListener("click", e => {
  const btn = e.target.closest(".edition-btn");
  if (!btn || btn.dataset.ed === state.edition) return;
  state.edition = btn.dataset.ed;
  saveState();
});

/* --- PROGRESSION, SCORE & NIVEAU --- */
function buildGradeMap() {
  const map = {};
  for (const g of state.gradedCards) {
    if (!map[g.cardId]) map[g.cardId] = new Set();
    map[g.cardId].add(g.grade);
  }
  return map;
}

function computeScore(gradeMap) {
  let score = 0, pairs = 0, complete = 0;
  for (const card of CARD_DATABASE) {
    const qty = state.collection[card.id] || 0;
    const grades = gradeMap[card.id];
    if (qty > 0) score += RARITY_POINTS[card.rarity];
    if (grades) {
      pairs += grades.size;
      if (qty > 0 && grades.size === GRADES.length) complete++;
    }
  }
  score += pairs * PAIR_POINTS + complete * COMPLETE_BONUS;
  return { score, pairs, complete, level: 1 + Math.floor(Math.sqrt(score / 3)) };
}

function progressHTML(versions) {
  const pct = Math.round((versions / TOTAL_VERSIONS) * 100);
  return `<div class="card-progress" title="Versions collectées (normale + notes)">
    <div class="card-progress-bar"><div style="width:${pct}%"></div></div>
    <span>${versions}/${TOTAL_VERSIONS}</span>
  </div>`;
}

function renderMyProgress(gradeMap) {
  const box = document.getElementById("my-progress");
  if (!box) return;
  const { score, pairs, complete, level } = computeScore(gradeMap);
  const floorScore = 3 * (level - 1) ** 2;
  const nextScore = 3 * level ** 2;
  const pct = Math.min(100, Math.round(((score - floorScore) / (nextScore - floorScore)) * 100));
  box.innerHTML = `
    <h3>Ma progression</h3>
    <div class="progress-level">Niveau <strong>${level}</strong> • ${score} pts</div>
    <div class="card-progress-bar big"><div style="width:${pct}%"></div></div>
    <p class="progress-next">Prochain niveau à ${nextScore} pts (encore ${nextScore - score})</p>
    <p class="progress-next">✨ ${complete} carte${complete > 1 ? "s" : ""} complète${complete > 1 ? "s" : ""} • 🎖️ ${pairs}/${CARD_DATABASE.length * GRADES.length} notes collectées</p>
  `;
}

/* --- MISE À JOUR GLOBALE DE L'INTERFACE --- */
function updateUI() {
  updateMultiButtons();
  updateDailyButton();
  if (typeof renderBonusCard === "function") renderBonusCard();
  renderEditionPicker();
  const gradeMap = buildGradeMap();
  const dupSlabs = getDuplicateSlabs();
  const dupSet = new Set(dupSlabs);
  document.getElementById("coins-display").textContent = state.coins;
  document.getElementById("gems-display").textContent = state.gems;
  document.getElementById("pack-count").textContent = state.packs;

  const uniqueOwned = Object.keys(state.collection).length;
  document.getElementById("nav-count").textContent = `${uniqueOwned}/${CARD_DATABASE.length}`;

  // Filtres Collection
  const rarityFilter = document.getElementById("filter-rarity").value;
  const statusFilter = document.getElementById("filter-status").value;
  const editionFilter = document.getElementById("filter-edition").value;

  // Cartes gradées
  const gradedSection = document.getElementById("graded-section");
  const gradedGrid = document.getElementById("graded-grid");
  if (state.gradedCards.length > 0 && statusFilter !== "OWNED") {
    gradedSection.classList.remove("hidden");
    gradedGrid.innerHTML = renderGradedShowcase();
  } else {
    gradedSection.classList.add("hidden");
  }

  // Cartodex
  const collectionGrid = document.getElementById("collection-grid");
  if (statusFilter === "GRADED") {
    collectionGrid.innerHTML = "";
  } else {
    const filtered = CARD_DATABASE.filter(c => {
      if (rarityFilter !== "ALL" && c.rarity !== rarityFilter) return false;
      if (editionFilter !== "ALL" && c.edition !== editionFilter) return false;
      if (statusFilter === "OWNED" && !state.collection[c.id]) return false;
      return true;
    });
    collectionGrid.innerHTML = filtered.map(c => {
      const qty = state.collection[c.id] || 0;
      const gradesOwned = gradeMap[c.id] ? gradeMap[c.id].size : 0;
      const versions = (qty > 0 ? 1 : 0) + gradesOwned;
      return renderCardHTML(c, {
        locked: qty === 0 && gradesOwned === 0,
        clickable: true,
        complete: qty > 0 && gradesOwned === GRADES.length,
        countText: qty > 0 ? `×${qty}` : (gradesOwned > 0 ? "Gradée" : "Manquante"),
        extraHTML: versions > 0 ? progressHTML(versions) : ""
      });
    }).join("");
  }

  // Sélecteur Gradation
  const gradingSelect = document.getElementById("grading-select");
  const previousGrading = gradingSelect.value;
  const ownedIds = Object.keys(state.collection);
  gradingSelect.innerHTML = ownedIds.length
    ? ownedIds.map(id => {
        const c = CARD_DATABASE.find(x => x.id === id);
        const notes = gradeMap[id] ? gradeMap[id].size : 0;
        return `<option value="${id}">#${c.id} - ${c.name} (${c.rarity}) [×${state.collection[id]}] • notes ${notes}/${GRADES.length} • 🪙 ${GRADE_COSTS[c.rarity]}</option>`;
      }).join("")
    : `<option value="">Aucune carte disponible</option>`;
  if (previousGrading && state.collection[previousGrading]) gradingSelect.value = previousGrading;

  // Grille Recyclage
  const recycleGrid = document.getElementById("recycle-grid");
  recycleGrid.innerHTML = ownedIds.map(id => {
    const c = CARD_DATABASE.find(x => x.id === id);
    const val = RARITY_CONFIG[c.rarity].recycleValue;
    return renderCardHTML(c, {
      countText: `×${state.collection[id]}`,
      extraHTML: `<button class="recycle-btn" onclick="recycleCard('${id}', 1)">Vendre 1 (+🪙 ${val})</button>`
    });
  }).join("") || "<p>Aucune carte à recycler.</p>";

  updateGradeButton();
  renderMyProgress(gradeMap);
  updateRecycleSlabsButton(dupSlabs);
  if (detailCardId) renderCardDetail();
}

document.getElementById("filter-rarity").addEventListener("change", updateUI);
document.getElementById("filter-status").addEventListener("change", updateUI);
document.getElementById("filter-edition").addEventListener("change", updateUI);

updateUI();

/* --- COMPTE DISCORD + SAUVEGARDE EN LIGNE (SUPABASE) --- */ 
const SUPABASE_URL = "https://nwvrymlezekhjxuypvgb.supabase.co";
const SUPABASE_KEY = "sb_publishable_srdivyuXUgAxzjYSWAihdQ_hOSW2CRK";
const SITE_URL = "https://lazynk.github.io/tcgisekaz/";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
let currentUser = null;
let syncedFor = null;   // id de l'utilisateur dont la synchro initiale est faite

const loginBtn = document.getElementById("btn-login");

function updateAuthUI() {
  if (currentUser) {
    const name = currentUser.user_metadata?.full_name || currentUser.user_metadata?.name || "Joueur";
    loginBtn.textContent = `${name} • Déconnexion`;
  } else {
    loginBtn.textContent = "Connexion Discord";
  }
}

loginBtn.addEventListener("click", async () => {
  if (currentUser) {
    await sb.auth.signOut();
    return;
  }
  await sb.auth.signInWithOAuth({
    provider: "discord",
    options: { redirectTo: SITE_URL }
  });
});

let syncing = false;
async function syncFromCloud() {
  if (!currentUser || syncedFor === currentUser.id || syncing) return;
  syncing = true;
  const userId = currentUser.id;
  // Le serveur crée la sauvegarde (en important, plafonnée, la progression d'invité) ou renvoie l'existante
  const r = await api("sync", { guest: state }, { silent: true });
  syncing = false;
  if (!r.ok) {
    showToast("❌ Impossible de synchroniser ta sauvegarde.");
    return;
  }
  syncedFor = userId;
  showToast(r.created
    ? (r.imported ? "☁️ Compte créé : ta progression a été importée !" : "☁️ Compte créé, bienvenue !")
    : "☁️ Sauvegarde en ligne chargée !");
  renderBonusCard();
  if (typeof grantDiscordBonus === "function") grantDiscordBonus();
}

sb.auth.onAuthStateChange((event, session) => {
  currentUser = session?.user ?? null;
  updateAuthUI();
  if (!currentUser) syncedFor = null;
  if (event === "SIGNED_OUT") {
    // La progression reste dans le compte en ligne ; on repart d'un mode invité tout neuf
    state = newGuestState(); clockSkew = 0;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (_) {}
    updateUI();
    if (typeof gRound !== "undefined") { gRound = null; gBetState = null; renderGames(); renderBonusCard(); }
  }
  // setTimeout : évite d'appeler Supabase directement dans ce callback
  if (currentUser) setTimeout(syncFromCloud, 0);
});

updateAuthUI();

/* --- CLASSEMENT --- */
function escapeHTML(str) {
  return String(str ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function loadLeaderboard() {
  const list = document.getElementById("leaderboard-list");
  list.innerHTML = `<p class="placeholder-text">Chargement…</p>`;

  const { data, error } = await sb
    .from("leaderboard")
    .select("*")
    .order("score", { ascending: false })
    .limit(50);

  if (error) {
    console.error("Erreur classement :", error);
    list.innerHTML = `<p class="placeholder-text">❌ Impossible de charger le classement.</p>`;
    return;
  }
  if (!data.length) {
    list.innerHTML = `<p class="placeholder-text">Aucun joueur classé pour l'instant. Connecte-toi avec Discord pour apparaître ici !</p>`;
    return;
  }

  const total = CARD_DATABASE.length;
  const myName = currentUser?.user_metadata?.full_name || currentUser?.user_metadata?.name || null;
  const medals = ["🥇", "🥈", "🥉"];

  list.innerHTML = `
    <div class="leaderboard-wrap">
      <table class="leaderboard-table">
        <thead>
          <tr><th>#</th><th>Joueur</th><th>Niveau</th><th>Score</th><th>Cartes</th><th>Complètes</th><th>Notes</th></tr>
        </thead>
        <tbody>
          ${data.map((p, i) => `
            <tr class="${p.username === myName ? "me" : ""}">
              <td class="rank-cell">${medals[i] || i + 1}</td>
              <td>${escapeHTML(p.username)}</td>
              <td>${p.level}</td>
              <td>${p.score}</td>
              <td>${p.unique_cards}/${total}</td>
              <td>${p.complete_cards ?? 0}</td>
              <td>${p.graded_pairs ?? 0}/${total * GRADES.length}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

document.getElementById("btn-refresh-leaderboard").addEventListener("click", loadLeaderboard);

/* --- PÉTALES DE CERISIER (décor) --- */
(function initSakura() {
  const layer = document.getElementById("sakura");
  if (!layer || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (let i = 0; i < 16; i++) {
    const petal = document.createElement("span");
    petal.className = "petal";
    petal.style.setProperty("--s", `${8 + Math.random() * 10}px`);
    petal.style.setProperty("--d", `${14 + Math.random() * 14}s`);
    petal.style.setProperty("--delay", `${-Math.random() * 24}s`);
    petal.style.setProperty("--sway", `${(Math.random() - 0.3) * 160}px`);
    petal.style.left = `${Math.random() * 100}%`;
    layer.appendChild(petal);
  }
})();
