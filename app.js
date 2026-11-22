const SAVE_KEY = "tcg_studio_save_v1";
const FREE_PACK_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes entre chaque booster gratuit
const PACK_COST = 150;
const SKIP_COST = 25;
const GRADE_COST = 250;

let state = loadState();

function loadState() {
  const saved = localStorage.getItem(SAVE_KEY);
  if (saved) return JSON.parse(saved);
  return {
    coins: 600,
    gems: 100,
    packs: 2,
    nextFreePackAt: Date.now() + FREE_PACK_INTERVAL_MS,
    collection: {}, // { "001": 3, ... }
    gradedCards: [] // [{ uid, cardId, grade, subgrades, isBlackLabel }]
  };
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
function rollCard(minRarity = null) {
  const pool = minRarity
    ? CARD_DATABASE.filter(c => ["R", "UR", "SEC"].includes(c.rarity))
    : CARD_DATABASE;

  const weighted = pool.map(card => ({
    card,
    weight: RARITY_CONFIG[card.rarity].weight
  }));
  const totalWeight = weighted.reduce((acc, item) => acc + item.weight, 0);
  let rnd = Math.random() * totalWeight;

  for (const item of weighted) {
    if (rnd < item.weight) return item.card;
    rnd -= item.weight;
  }
  return pool[0];
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
  pulled.forEach(c => {
    state.collection[c.id] = (state.collection[c.id] || 0) + 1;
  });
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

    const revealSlot = (slot) => {
      if (slot.classList.contains("flipped")) return;
      slot.classList.add("flipped");
      revealedCount++;

      const rarity = slot.dataset.rarity;
      if (rarity === "SEC") showToast("🌟 CARTE SECRÈTE DÉBLOQUÉE !");
      else if (rarity === "UR") showToast("🔥 ULTRA RARE !");

      if (revealedCount === slots.length) {
        revealAllBtn.classList.add("hidden");
        closeBtn.classList.remove("hidden");
        hint.textContent = "Survole les cartes pour admirer les reflets holographiques !";
      }
    };

    slots.forEach(slot => {
      slot.addEventListener("click", () => revealSlot(slot));
    });

    revealAllBtn.onclick = () => {
      slots.forEach((slot, i) => {
        setTimeout(() => revealSlot(slot), i * 140);
      });
    };

    attachHoloListeners(container);
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

document.getElementById("btn-skip-timer").addEventListener("click", () => {
  if (state.gems < SKIP_COST) return showToast("❌ Pas assez de gemmes !");
  state.gems -= SKIP_COST;
  state.packs += 1;
  state.nextFreePackAt = Date.now() + FREE_PACK_INTERVAL_MS;
  saveState();
  showToast("⚡ Booster instantané récupéré !");
});

/* --- SYSTÈME DE GRADATION --- */
document.getElementById("btn-grade-card").addEventListener("click", () => {
  const cardId = document.getElementById("grading-select").value;
  if (!cardId || !state.collection[cardId]) return showToast("❌ Sélectionne une carte valide.");
  if (state.coins < GRADE_COST) return showToast("❌ Il faut 250 pièces pour grader une carte.");

  state.coins -= GRADE_COST;
  state.collection[cardId] -= 1;
  if (state.collection[cardId] <= 0) delete state.collection[cardId];

  // Calcul pondéré de la note sur 10
  const roll = Math.random();
  let grade = 8.5;
  if (roll > 0.96) grade = 10;
  else if (roll > 0.82) grade = 9.5;
  else if (roll > 0.55) grade = 9;
  else if (roll > 0.25) grade = 8.5;
  else grade = 8;

  const isBlackLabel = grade === 10 && Math.random() > 0.7;
  const subgrades = {
    centering: isBlackLabel ? 10 : Math.min(10, grade + (Math.random() > 0.5 ? 0.5 : 0)),
    corners:   isBlackLabel ? 10 : grade,
    edges:     isBlackLabel ? 10 : Math.min(10, grade + (Math.random() > 0.6 ? 0.5 : 0)),
    surface:   isBlackLabel ? 10 : grade
  };

  const gradedObj = {
    uid: `SLAB-${Date.now().toString().slice(-5)}`,
    cardId,
    grade,
    subgrades,
    isBlackLabel
  };

  state.gradedCards.unshift(gradedObj);
  saveState();

  const zone = document.getElementById("grading-result-zone");
  zone.innerHTML = renderSlabHTML(gradedObj);
  attachHoloListeners(zone);
  showToast(isBlackLabel ? "🌟 INCROYABLE ! BLACK LABEL 10 !" : `🏆 Carte gradée ${grade}/10 !`);
});

/* --- RECYCLAGE --- */
function recycleCard(cardId, count = 1) {
  const card = CARD_DATABASE.find(c => c.id === cardId);
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
  const artStyle = card.image
    ? `background-image: url('${card.image}')`
    : `background: ${card.bg}`;
  const artContent = card.image ? "" : card.emoji;

  return `
    <div class="tcg-card rarity-${card.rarity} ${opts.locked ? "locked" : ""}">
      <div class="holo-overlay"></div>
      <div class="card-header">
        <span>#${card.id}</span>
        <span>${card.rarity}</span>
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

function renderSlabHTML(slab) {
  const card = CARD_DATABASE.find(c => c.id === slab.cardId);
  const labelTitle = slab.isBlackLabel ? "BLACK LABEL 10" : (slab.grade === 10 ? "GEM MINT" : "MINT");
  return `
    <div class="slab-wrapper">
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
    </div>
  `;
}

function attachHoloListeners(root = document) {
  root.querySelectorAll(".tcg-card").forEach(card => {
    card.addEventListener("mousemove", e => {
      const rect = card.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      card.style.setProperty("--mx", `${x}%`);
      card.style.setProperty("--my", `${y}%`);
      const rotY = ((x - 50) / 50) * 10;
      const rotX = ((50 - y) / 50) * 10;
      card.style.transform = `perspective(600px) rotateX(${rotX}deg) rotateY(${rotY}deg)`;
    });
    card.addEventListener("mouseleave", () => {
      card.style.transform = "perspective(600px) rotateX(0) rotateY(0)";
    });
  });
}

/* --- MISE À JOUR GLOBALE DE L'INTERFACE --- */
function updateUI() {
  document.getElementById("coins-display").textContent = state.coins;
  document.getElementById("gems-display").textContent = state.gems;
  document.getElementById("pack-count").textContent = state.packs;

  const uniqueOwned = Object.keys(state.collection).length;
  document.getElementById("nav-count").textContent = `${uniqueOwned}/${CARD_DATABASE.length}`;

  // Filtres Collection
  const rarityFilter = document.getElementById("filter-rarity").value;
  const statusFilter = document.getElementById("filter-status").value;

  // Cartes gradées
  const gradedSection = document.getElementById("graded-section");
  const gradedGrid = document.getElementById("graded-grid");
  if (state.gradedCards.length > 0 && statusFilter !== "OWNED") {
    gradedSection.classList.remove("hidden");
    gradedGrid.innerHTML = state.gradedCards.map(renderSlabHTML).join("");
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
      if (statusFilter === "OWNED" && !state.collection[c.id]) return false;
      return true;
    });
    collectionGrid.innerHTML = filtered.map(c => {
      const qty = state.collection[c.id] || 0;
      return renderCardHTML(c, { locked: qty === 0, countText: qty > 0 ? `×${qty}` : "Manquante" });
    }).join("");
  }

  // Sélecteur Gradation
  const gradingSelect = document.getElementById("grading-select");
  const ownedIds = Object.keys(state.collection);
  gradingSelect.innerHTML = ownedIds.length
    ? ownedIds.map(id => {
        const c = CARD_DATABASE.find(x => x.id === id);
        return `<option value="${id}">#${c.id} - ${c.name} (${c.rarity}) [×${state.collection[id]}]</option>`;
      }).join("")
    : `<option value="">Aucune carte disponible</option>`;

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

  attachHoloListeners();
}

document.getElementById("filter-rarity").addEventListener("change", updateUI);
document.getElementById("filter-status").addEventListener("change", updateUI);

/* --- EXPORT / IMPORT SAUVEGARDE --- */
document.getElementById("btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "sauvegarde-tcg.json";
  a.click();
});

document.getElementById("btn-import").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    state = JSON.parse(ev.target.result);
    saveState();
    showToast("✅ Sauvegarde restaurée !");
  };
  reader.readAsText(file);
});

updateUI();
