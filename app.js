const SAVE_KEY = "tcg_studio_save_v1";
const FREE_PACK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes entre chaque booster gratuit
const PACK_COST = 150;
const DAILY_BASE = 100;       // bonus quotidien de base
const DAILY_STREAK_STEP = 25; // +25 par jour consécutif
const DAILY_STREAK_MAX = 6;   // plafonné à +150 (jour 7 et suivants = 250)
const DISCOVERY_BONUS = { C: 5, UC: 10, R: 25, UR: 60, SEC: 150 }; // 1re fois qu'on obtient une carte

function todayKey(offset = 0) {
  const d = new Date(Date.now() + offset * 86400000);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function dailyAvailable() { return state.lastDaily !== todayKey(); }
function nextDailyStreak() { return state.lastDaily === todayKey(-1) ? (state.dailyStreak || 0) + 1 : 1; }
function dailyReward(streak) { return DAILY_BASE + DAILY_STREAK_STEP * Math.min(streak - 1, DAILY_STREAK_MAX); }
function claimDaily() {
  if (!dailyAvailable()) return showToast("⏳ Bonus déjà récupéré aujourd'hui, reviens demain !");
  const streak = nextDailyStreak();
  const gain = dailyReward(streak);
  state.coins += gain;
  state.lastDaily = todayKey();
  state.dailyStreak = streak;
  saveState();
  showToast(`🎁 Bonus quotidien : +🪙 ${gain} (série de ${streak} jour${streak > 1 ? "s" : ""})`);
}
function updateDailyButton() {
  const btn = document.getElementById("btn-daily");
  if (!btn) return;
  if (dailyAvailable()) {
    btn.disabled = false;
    btn.textContent = `🎁 BONUS QUOTIDIEN • 🪙 ${dailyReward(nextDailyStreak())}`;
  } else {
    btn.disabled = true;
    btn.textContent = `✅ BONUS RÉCUPÉRÉ • série ${state.dailyStreak || 1} j • demain 🪙 ${dailyReward((state.dailyStreak || 1) + 1)}`;
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
  localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  queueCloudSave();
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
setInterval(() => {
  const now = Date.now();
  if (now >= state.nextFreePackAt) {
    state.packs += 1;
    state.nextFreePackAt = now + FREE_PACK_INTERVAL_MS;
    saveState();
    showToast("🎁 Un booster gratuit vient d'arriver !");
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
  let pool = CARD_DATABASE.filter(c => c.edition === edition);
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

function openPack() {
  if (isOpeningPack) return;
  if (state.packs <= 0) {
    showToast("❌ Aucun booster disponible ! Achètes-en un ou attends le timer.");
    return;
  }

  isOpeningPack = true;
  state.packs -= 1;

  // 4 cartes aléatoires + 1 carte garantie Rare minimum en dernière position
  const pulled = [rollCard(), rollCard(), rollCard(), rollCard(), rollCard("R")];
  // Précharge les illustrations pour qu'elles soient prêtes au retournement
  pulled.forEach(c => { if (c.image) new Image().src = c.image; });
  let discovery = 0;
  pulled.forEach(c => {
    if (!state.collection[c.id] && !state.gradedCards.some(g => g.cardId === c.id)) discovery += DISCOVERY_BONUS[c.rarity] || 0;
    state.collection[c.id] = (state.collection[c.id] || 0) + 1;
  });
  if (discovery > 0) {
    state.coins += discovery;
    setTimeout(() => showToast(`🆕 Nouvelles cartes découvertes : +🪙 ${discovery}`), 3500);
  }
  saveState();

  // Animation de déchirure du booster avant d'afficher les cartes dos tourné
  const packEl = document.getElementById("booster-pack");
  packEl.classList.add("opening");

  setTimeout(() => {
    packEl.classList.remove("opening");
    isOpeningPack = false;

    const modal = document.getElementById("pack-modal");
    const container = document.getElementById("opened-cards-container");
    const closeBtn = document.getElementById("btn-close-modal");
    const hint = modal.querySelector(".modal-hint");

    closeBtn.classList.add("hidden");
    hint.textContent = "Clique sur chaque carte pour la révéler une par une !";

    // Génération des 5 emplacements face cachée
    container.innerHTML = pulled.map((card, idx) => `
      <div class="flip-slot" data-rarity="${card.rarity}" data-index="${idx}">
        <div class="flip-inner">
          <div class="flip-back">
            <div class="flip-back-emblem">✦</div>
            <div class="flip-back-label">Carte ${idx + 1}/5</div>
          </div>
          <div class="flip-front">
            ${renderCardHTML(card)}
          </div>
        </div>
      </div>
    `).join("");

    // Ajout d'un bouton "Tout révéler" à côté du bouton final
    let revealAllBtn = document.getElementById("btn-reveal-all");
    if (!revealAllBtn) {
      revealAllBtn = document.createElement("button");
      revealAllBtn.id = "btn-reveal-all";
      revealAllBtn.className = "btn-secondary";
      revealAllBtn.textContent = "TOUT RÉVÉLER";
      closeBtn.parentNode.insertBefore(revealAllBtn, closeBtn);
    }
    revealAllBtn.classList.remove("hidden");

    let revealedCount = 0;
    const slots = container.querySelectorAll(".flip-slot");

    const SUSPENSE = { R: 500, UR: 900, SEC: 1400 };

    const revealSlot = (slot, skipSuspense = false) => {
      if (slot.classList.contains("flipped") || slot.classList.contains("charging")) return;
      const rarity = slot.dataset.rarity;

      const doFlip = () => {
        slot.classList.remove("charging");
        slot.classList.add("flipped");
        revealedCount++;

        if (SUSPENSE[rarity]) playRareEffect(slot, rarity);
        if (rarity === "SEC") showToast("🌟 CARTE SECRÈTE DÉBLOQUÉE !");
        else if (rarity === "UR") showToast("🔥 ULTRA RARE !");

        if (revealedCount === slots.length) {
          revealAllBtn.classList.add("hidden");
          closeBtn.classList.remove("hidden");
          hint.textContent = "Survole les cartes pour admirer les reflets holographiques !";
        }
      };

      if (SUSPENSE[rarity] && !skipSuspense) {
        slot.classList.add("charging");
        setTimeout(doFlip, SUSPENSE[rarity]);
      } else {
        doFlip();
      }
    };

    slots.forEach(slot => {
      slot.addEventListener("click", () => revealSlot(slot));
    });

    revealAllBtn.onclick = () => {
      slots.forEach((slot, i) => {
        setTimeout(() => revealSlot(slot, true), i * 140);
      });
    };

    modal.classList.remove("hidden");
  }, 520);
}

document.getElementById("btn-open-pack").addEventListener("click", openPack);
document.getElementById("booster-pack").addEventListener("click", openPack);
document.getElementById("btn-close-modal").addEventListener("click", () => {
  document.getElementById("pack-modal").classList.add("hidden");
});

document.getElementById("btn-buy-pack").addEventListener("click", () => {
  if (state.coins < PACK_COST) return showToast("❌ Pas assez de pièces !");
  state.coins -= PACK_COST;
  state.packs += 1;
  saveState();
  showToast("🛒 +1 Booster ajouté à ton inventaire !");
});

document.getElementById("btn-daily").addEventListener("click", claimDaily);
document.getElementById("btn-skip-timer").addEventListener("click", () => {
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

document.getElementById("btn-grade-card").addEventListener("click", () => {
  const cardId = document.getElementById("grading-select").value;
  if (!cardId || !state.collection[cardId]) return showToast("❌ Sélectionne une carte valide.");
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

  const zone = document.getElementById("grading-result-zone");
  zone.innerHTML = renderSlabHTML(gradedObj);

  const isNew = !alreadyHad.has(grade);
  const allGrades = new Set([...alreadyHad, grade]).size === GRADES.length;
  const hasNormal = (state.collection[cardId] || 0) > 0;

  if (allGrades && hasNormal) showToast("🏆 CARTE COMPLÈTE ! Cadre doré débloqué !");
  else if (allGrades) showToast("✅ 11/11 notes ! Il te faut encore un exemplaire normal pour compléter la carte.");
  else if (isBlackLabel) showToast("🌟 INCROYABLE ! BLACK LABEL 10 !");
  else if (isNew) showToast(`🆕 Nouvelle note : ${grade}/10 !`);
  else showToast(`Note ${grade}/10 déjà possédée pour cette carte.`);
});

/* --- RECYCLAGE --- */
function recycleCard(cardId, count = 1) {
  const card = CARD_BY_ID[cardId];
  if (!card || (state.collection[cardId] || 0) < count) return;
  state.collection[cardId] -= count;
  if (state.collection[cardId] <= 0) delete state.collection[cardId];
  const gain = RARITY_CONFIG[card.rarity].recycleValue * count;
  state.coins += gain;
  saveState();
  showToast(`♻️ +${gain} pièces récupérées !`);
}

document.getElementById("btn-recycle-all").addEventListener("click", () => {
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
    <div class="tcg-card rarity-${card.rarity} ${opts.locked ? "locked" : ""} ${opts.complete ? "complete" : ""} ${opts.clickable ? "clickable" : ""}" data-card-id="${card.id}">
      <div class="holo-overlay"></div>
      <div class="card-header">
        <span>#${card.id}</span>
        <span>${card.rarity}${opts.complete ? " ★ 100 %" : ""}</span>
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

function recycleSlabs(list) {
  if (!list.length) return;
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
      recycleCard(detailCardId, Math.max(0, (state.collection[detailCardId] || 0) - 1));
    } else {
      recycleSlabs(getDuplicateSlabs().filter(s => s.cardId === detailCardId && s.grade === Number(kind)));
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
  const recycleBtn = e.target.closest(".slab-recycle");
  if (recycleBtn) {
    const slab = getDuplicateSlabs().find(s => s.uid === recycleBtn.dataset.uid);
    if (slab) recycleSlabs([slab]);
    return;
  }
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
  updateDailyButton();
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
    const hidden = state.gradedCards.length - SLAB_DISPLAY_LIMIT;
    gradedGrid.innerHTML = state.gradedCards.slice(0, SLAB_DISPLAY_LIMIT).map(s => renderSlabHTML(s, { clickable: true, dupValue: dupSet.has(s) ? slabRecycleValue(s) : 0 })).join("") +
      (hidden > 0 ? `<p class="placeholder-text">… et ${hidden} autre${hidden > 1 ? "s" : ""} carte${hidden > 1 ? "s" : ""} gradée${hidden > 1 ? "s" : ""}</p>` : "");
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
let pushTimer = null;

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

async function pushToCloud() {
  if (!currentUser) return;
  const { error } = await sb.from("saves").upsert({
    user_id: currentUser.id,
    data: state,
    updated_at: new Date().toISOString()
  });
  if (error) console.error("Erreur sauvegarde cloud :", error);
}

function queueCloudSave() {
  if (!currentUser || syncedFor !== currentUser.id) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushToCloud, 1500);
}

async function syncFromCloud() {
  if (!currentUser || syncedFor === currentUser.id) return;
  const userId = currentUser.id;

  const { data, error } = await sb
    .from("saves")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error(error);
    showToast("❌ Impossible de synchroniser ta sauvegarde.");
    return;
  }

  syncedFor = userId;

  if (data) {
    // Une sauvegarde en ligne existe : on la charge
    state = migrateState(data.data);
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    updateUI();
    showToast("☁️ Sauvegarde en ligne chargée !");
  } else {
    // Première connexion : on envoie la progression locale actuelle
    await pushToCloud();
    showToast("☁️ Ta progression a été envoyée en ligne !");
  }
}

sb.auth.onAuthStateChange((event, session) => {
  currentUser = session?.user ?? null;
  updateAuthUI();
  if (!currentUser) syncedFor = null;
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
