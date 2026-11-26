// TCG Isekaz — Edge Function "game" : toute la logique de jeu côté serveur.
// Le navigateur n'écrit plus jamais sa sauvegarde : il demande une action, le serveur applique les règles
// et renvoie le nouvel état. Secret requis pour les bonus Discord : DISCORD_BOT_TOKEN.
import { createClient } from "npm:@supabase/supabase-js@2";

const GUILD_ID = "984180525407273030";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

/* ---------------- Règles du jeu (identiques à l'ancien code navigateur) ---------------- */
const RARITY: Record<string, { weight: number; recycle: number }> = {
  C: { weight: 55, recycle: 5 }, UC: { weight: 28, recycle: 12 }, R: { weight: 12, recycle: 35 },
  UR: { weight: 4, recycle: 90 }, SEC: { weight: 1, recycle: 200 },
};
const FREE_PACK_INTERVAL_MS = 30 * 60 * 1000;
const PACK_COST = 150, SKIP_COST = 25, ISEKAZ_COST = 50, ISEKAZ_CARDS = 10, ISEKAZ_HANDMADE_CHANCE = 0.03;
const DAILY_BASE = 100, DAILY_STREAK_STEP = 25, DAILY_STREAK_MAX = 6, DAILY_GEMS = 10;
const DISCOVERY_BONUS: Record<string, number> = { C: 5, UC: 10, R: 25, UR: 60, SEC: 150 };
const DISCOVERY_GEMS: Record<string, number> = { UR: 5, SEC: 15 };   // diamants à la 1re découverte (UR / secrète)
const ISEKAZ_DISCOVERY_GEMS = 5;                                      // en plus, pour toute carte de la série Isekaz
const GRADES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 9.5, 10];
const GRADE_WEIGHTS: Record<string, number> = { "1": 4, "2": 5, "3": 7, "4": 9, "5": 12, "6": 14, "7": 14, "8": 12, "9": 10, "9.5": 8, "10": 5 };
const GRADE_COSTS: Record<string, number> = { C: 20, UC: 35, R: 60, UR: 120, SEC: 250 };
const GRADE_RECYCLE_FACTOR: Record<string, number> = { "1": 0.15, "2": 0.2, "3": 0.25, "4": 0.3, "5": 0.35, "6": 0.4, "7": 0.45, "8": 0.5, "9": 0.6, "9.5": 0.7, "10": 0.9 };
const DISCORD_BONUS = 300, DISCORD_GEMS = 50, SERVER_BONUS = 400, SERVER_GEMS = 100, COMPLETE_GEMS = 25;
const GAME_DAILY_PLAYS = 3, GEM_DROP_CHANCE = 0.25;
const BET_OPTIONS = [10, 25, 50, 100, 250], BET_MULT = 2.7;
const PIXEL_CELLS = [6, 8, 10, 12, 16];
const PIXEL_REWARD: Record<string, number> = { "6": 30, "8": 25, "10": 22, "12": 20, "16": 15 };
const ZOOM_FRACS = [0.18, 0.22, 0.28, 0.34];
const ZOOM_REWARD: Record<string, number> = { "0.18": 30, "0.22": 25, "0.28": 20, "0.34": 15 };

/* ---------------- Utilitaires ---------------- */
const json = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Aléatoire cryptographique (non prévisible depuis le navigateur)
const rnd = () => crypto.getRandomValues(new Uint32Array(1))[0] / 4294967296;
const rint = (n: number) => Math.floor(rnd() * n);
const pick = <T>(a: T[]): T => a[rint(a.length)];
function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = rint(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
const parisDay = (offsetDays = 0) =>
  new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + offsetDays * 86400000));

class GameError extends Error {
  constructor(public code: string, message: string) { super(message); }
}
const fail = (code: string, message: string): never => { throw new GameError(code, message); };

/* ---------------- Cartes (table cards_ref, mise en cache 60 s) ---------------- */
type Card = { id: string; name: string; rarity: string; edition: string; series: string | null; handmade: boolean };
let cardCache: { at: number; list: Card[]; byId: Map<string, Card> } | null = null;
async function cards() {
  if (cardCache && Date.now() - cardCache.at < 60_000) return cardCache;
  const { data, error } = await db.from("cards_ref").select("id, name, rarity, edition, series, handmade");
  if (error || !data?.length) throw new Error("cards_ref illisible : " + (error?.message ?? "vide"));
  const list = data.map((c: any) => ({ ...c, handmade: !!c.handmade })) as Card[];
  cardCache = { at: Date.now(), list, byId: new Map(list.map((c) => [c.id, c])) };
  return cardCache;
}
function rollFrom(pool: Card[]): Card {
  const total = pool.reduce((n, c) => n + RARITY[c.rarity].weight, 0);
  let r = rnd() * total;
  for (const c of pool) { if (r < RARITY[c.rarity].weight) return c; r -= RARITY[c.rarity].weight; }
  return pool[0];
}

/* ---------------- État de jeu ---------------- */
function freshState(): any {
  return {
    coins: 600, gems: 100, packs: 2, edition: "E1",
    nextFreePackAt: Date.now() + FREE_PACK_INTERVAL_MS,
    collection: {}, gradedCards: [],
  };
}

// Remet un état dans la forme attendue ; rattrape aussi les anciens bonus (diamants Discord)
function normalize(s: any): any {
  s = s && typeof s === "object" ? s : freshState();
  const num = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : d);
  s.coins = num(s.coins, 0); s.gems = num(s.gems, 0); s.packs = num(s.packs, 0);
  s.nextFreePackAt = Number.isFinite(Number(s.nextFreePackAt)) ? Number(s.nextFreePackAt) : Date.now() + FREE_PACK_INTERVAL_MS;
  s.collection = s.collection && typeof s.collection === "object" ? s.collection : {};
  s.gradedCards = Array.isArray(s.gradedCards) ? s.gradedCards : [];
  s.gradedCards.forEach((g: any) => { if (!GRADES.includes(g.grade)) g.grade = Math.max(1, Math.floor(g.grade)); });
  if (!s.completeGems || typeof s.completeGems !== "object") s.completeGems = {};
  if (s.discordBonus && !s.discordGems) { s.discordGems = true; s.gems += DISCORD_GEMS; }
  if (s.serverBonus && !s.serverGems) { s.serverGems = true; s.gems += SERVER_GEMS; }
  if (!s.games || s.games.day !== parisDay()) s.games = { day: parisDay(), pixel: 0, zoom: 0 };
  return s;
}

function gradeMap(s: any): Map<string, Set<number>> {
  const m = new Map<string, Set<number>>();
  for (const g of s.gradedCards) {
    if (!m.has(g.cardId)) m.set(g.cardId, new Set());
    m.get(g.cardId)!.add(g.grade);
  }
  return m;
}
// 25 diamants la première fois qu'une carte devient complète (normale + 11 notes)
function awardComplete(s: any, byId: Map<string, Card>): number {
  const gm = gradeMap(s);
  let n = 0;
  for (const [id, grades] of gm) {
    if (!byId.has(id) || s.completeGems[id]) continue;
    if (grades.size === GRADES.length && (s.collection[id] || 0) > 0) { s.completeGems[id] = true; n++; }
  }
  s.gems += n * COMPLETE_GEMS;
  return n * COMPLETE_GEMS;
}

const slabQuality = (g: any) => {
  const sg = g.subgrades || {};
  return (g.isBlackLabel ? 100 : 0) + (sg.centering || 0) + (sg.corners || 0) + (sg.edges || 0) + (sg.surface || 0);
};
const slabValue = (g: any, byId: Map<string, Card>) => {
  const c = byId.get(g.cardId);
  return c ? Math.max(1, Math.round(GRADE_COSTS[c.rarity] * (GRADE_RECYCLE_FACTOR[String(g.grade)] ?? 0.2))) : 0;
};
// Doublons gradés = tout sauf la meilleure carte de chaque combinaison carte + note
function duplicateSlabs(s: any): any[] {
  const groups = new Map<string, any[]>();
  for (const g of s.gradedCards) {
    const k = `${g.cardId}|${g.grade}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(g);
  }
  const dups: any[] = [];
  for (const list of groups.values()) { list.sort((a, b) => slabQuality(b) - slabQuality(a)); dups.push(...list.slice(1)); }
  return dups;
}
const removeSlabs = (s: any, list: any[]) => { const set = new Set(list); s.gradedCards = s.gradedCards.filter((g: any) => !set.has(g)); };

// État renvoyé au navigateur : sans les données privées du serveur
const publicState = (s: any) => { const { _pending, ...rest } = s; return rest; };

/* ---------------- Import de la progression d'un invité (une seule fois, plafonné) ---------------- */
function sanitizeImport(g: any, byId: Map<string, Card>): any {
  const s = freshState();
  if (!g || typeof g !== "object") return s;
  const cap = (v: unknown, max: number, d: number) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(max, Math.floor(Number(v)))) : d);
  s.coins = cap(g.coins, 3000, s.coins); s.gems = cap(g.gems, 300, s.gems); s.packs = cap(g.packs, 20, s.packs);
  let total = 0;
  if (g.collection && typeof g.collection === "object") {
    for (const [id, q] of Object.entries(g.collection)) {
      if (!byId.has(id) || total >= 400) continue;
      const qty = Math.min(cap(q, 30, 0), 400 - total);
      if (qty > 0) { s.collection[id] = qty; total += qty; }
    }
  }
  if (Array.isArray(g.gradedCards)) {
    for (const x of g.gradedCards.slice(0, 120)) {
      if (!x || !byId.has(x.cardId) || !GRADES.includes(Number(x.grade))) continue;
      const sg = x.subgrades || {};
      const sub = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? Math.min(10, Math.max(1, n)) : Number(x.grade); };
      s.gradedCards.push({
        uid: newUid(s), cardId: x.cardId, grade: Number(x.grade), isBlackLabel: !!x.isBlackLabel && Number(x.grade) === 10,
        subgrades: { centering: sub(sg.centering), corners: sub(sg.corners), edges: sub(sg.edges), surface: sub(sg.surface) },
      });
    }
  }
  if (g.edition) s.edition = String(g.edition).slice(0, 4);
  return s;
}
function newUid(s: any): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const used = new Set(s.gradedCards.map((x: any) => x.uid));
  for (;;) {
    const uid = "SLAB-" + Array.from({ length: 6 }, () => A[rint(A.length)]).join("");
    if (!used.has(uid)) return uid;
  }
}

/* ---------------- Actions ---------------- */
type Ctx = { user: any; byId: Map<string, Card>; list: Card[]; body: any };
type Out = { result?: Record<string, unknown> };

const handlers: Record<string, (s: any, c: Ctx) => Promise<Out> | Out> = {
  sync: () => ({}),

  buy_pack: (s) => {
    if (s.coins < PACK_COST) fail("no_coins", "Pas assez de pièces !");
    s.coins -= PACK_COST; s.packs += 1;
    return {};
  },

  free_pack: (s) => {
    const now = Date.now();
    if (now < s.nextFreePackAt) return { result: { granted: false } };
    s.packs += 1; s.nextFreePackAt = now + FREE_PACK_INTERVAL_MS;
    return { result: { granted: true } };
  },

  skip_timer: (s) => {
    if (s.gems < SKIP_COST) fail("no_gems", "Pas assez de gemmes !");
    s.gems -= SKIP_COST; s.packs += 1; s.nextFreePackAt = Date.now() + FREE_PACK_INTERVAL_MS;
    return {};
  },

  claim_daily: (s) => {
    if (s.lastDaily === parisDay()) fail("daily_taken", "Bonus déjà récupéré aujourd'hui, reviens demain !");
    const streak = s.lastDaily === parisDay(-1) ? (s.dailyStreak || 0) + 1 : 1;
    const gain = DAILY_BASE + DAILY_STREAK_STEP * Math.min(streak - 1, DAILY_STREAK_MAX);
    s.coins += gain; s.gems += DAILY_GEMS; s.lastDaily = parisDay(); s.dailyStreak = streak;
    return { result: { gain, gems: DAILY_GEMS, streak } };
  },

  open_pack: (s, c) => {
    const edition = String(c.body.edition || "E1");
    const count = Math.min(10, Math.max(1, Math.floor(Number(c.body.count) || 1)));
    const autoBuy = !!c.body.autoBuy;   // achète les boosters manquants avec des pièces
    const classic = c.list.filter((x) => x.edition !== "E4");
    const pulled: Card[] = [];
    let bought = 0;
    if (edition === "E4") {
      if (s.gems < ISEKAZ_COST * count) fail("no_gems", `Il faut 💎 ${ISEKAZ_COST * count} pour ouvrir ${count > 1 ? count + " boosters Isekaz" : "un booster Isekaz"}.`);
      s.gems -= ISEKAZ_COST * count;
      const series = c.list.filter((x) => x.edition === "E4");
      const handmade = series.filter((x) => x.handmade), regular = series.filter((x) => !x.handmade);
      for (let n = 0; n < count; n++) {
        for (let i = 0; i < ISEKAZ_CARDS - 1; i++) pulled.push(rollFrom(classic));
        pulled.push(pick(rnd() < ISEKAZ_HANDMADE_CHANCE && handmade.length ? handmade : regular));
      }
    } else {
      const pool = c.list.filter((x) => x.edition === edition);
      if (!pool.length) fail("bad_request", "Édition inconnue.");
      const missing = Math.max(0, count - s.packs);
      if (missing > 0) {
        if (!autoBuy) fail("no_pack", "Aucun booster disponible ! Achètes-en un ou attends le timer.");
        if (s.coins < missing * PACK_COST) fail("no_coins", "Pas assez de pièces pour acheter les boosters manquants.");
        s.coins -= missing * PACK_COST; s.packs += missing; bought = missing;
      }
      s.packs -= count;
      const rare = pool.filter((x) => ["R", "UR", "SEC"].includes(x.rarity));
      for (let n = 0; n < count; n++) {
        for (let i = 0; i < 4; i++) pulled.push(rollFrom(pool));
        pulled.push(rollFrom(rare));
      }
    }
    let discovery = 0, discoveryGems = 0;
    const bonuses: { id: string; coins: number; gems: number }[] = [];
    const gradedIds = new Set(s.gradedCards.map((g: any) => g.cardId));
    for (const card of pulled) {
      if (!s.collection[card.id] && !gradedIds.has(card.id)) {
        const coins = DISCOVERY_BONUS[card.rarity] || 0;
        const gems = (DISCOVERY_GEMS[card.rarity] || 0) + (card.edition === "E4" ? ISEKAZ_DISCOVERY_GEMS : 0);
        discovery += coins; discoveryGems += gems; bonuses.push({ id: card.id, coins, gems });
      }
      s.collection[card.id] = (s.collection[card.id] || 0) + 1;
    }
    s.coins += discovery; s.gems += discoveryGems;
    return { result: { cards: pulled.map((x) => x.id), discovery, discoveryGems, bonuses, count, bought } };
  },

  grade: (s, c) => {
    const cardId = String(c.body.cardId || "");
    const card = c.byId.get(cardId);
    if (!card || !s.collection[cardId]) fail("bad_card", "Sélectionne une carte valide.");
    const cost = GRADE_COSTS[card!.rarity];
    if (s.coins < cost) fail("no_coins", `Il faut ${cost} pièces pour grader cette carte.`);
    const alreadyHad = new Set(s.gradedCards.filter((g: any) => g.cardId === cardId).map((g: any) => g.grade));
    s.coins -= cost;
    s.collection[cardId] -= 1;
    if (s.collection[cardId] <= 0) delete s.collection[cardId];

    let r = rnd() * 100, grade = 10;
    for (const g of GRADES) { r -= GRADE_WEIGHTS[String(g)]; if (r < 0) { grade = g; break; } }
    const isBlackLabel = grade === 10 && rnd() > 0.7;
    const bump = (chance: number) => Math.min(10, grade + (rnd() < chance ? 0.5 : 0));
    const slab = {
      uid: newUid(s), cardId, grade, isBlackLabel,
      subgrades: {
        centering: isBlackLabel ? 10 : bump(0.5), corners: isBlackLabel ? 10 : grade,
        edges: isBlackLabel ? 10 : bump(0.4), surface: isBlackLabel ? 10 : grade,
      },
    };
    s.gradedCards.unshift(slab);
    const allGrades = new Set([...alreadyHad, grade]).size === GRADES.length;
    return { result: { slab, isNew: !alreadyHad.has(grade), allGrades, hasNormal: (s.collection[cardId] || 0) > 0 } };
  },

  // kind: "normal" (doublons d'une carte, ou "count" exemplaires) | "all_normal" | "slabs" (cardId?, grade?) | "card_all" (cardId)
  recycle: (s, c) => {
    const kind = String(c.body.kind || "");
    let gain = 0, count = 0;
    const normalDups = (id: string, max = Infinity) => {
      const card = c.byId.get(id);
      const qty = s.collection[id] || 0;
      if (!card || qty < 1) return;
      const n = Math.min(qty - 1, max);          // un exemplaire est toujours conservé
      if (n <= 0) return;
      s.collection[id] -= n; gain += n * RARITY[card.rarity].recycle; count += n;
    };
    if (kind === "normal") {
      const id = String(c.body.cardId || "");
      const card = c.byId.get(id);
      if (!card) fail("bad_card", "Carte inconnue.");
      const have = s.collection[id] || 0;
      let n = Math.max(1, Math.floor(Number(c.body.count) || 1));
      if (c.body.dupsOnly) n = Math.min(n, have - 1);   // depuis la fiche carte : on garde toujours un exemplaire
      if (n <= 0) fail("no_dup", "Aucun doublon à recycler !");
      if (n > have) fail("bad_card", "Tu n'as pas assez d'exemplaires.");
      s.collection[id] = have - n; if (s.collection[id] <= 0) delete s.collection[id];
      gain = n * RARITY[card!.rarity].recycle; count = n;
    } else if (kind === "all_normal") {
      for (const id of Object.keys(s.collection)) normalDups(id);
      for (const id of Object.keys(s.collection)) if (s.collection[id] <= 0) delete s.collection[id];
      if (!count) fail("no_dup", "Aucun doublon à recycler !");
    } else if (kind === "slabs") {
      let dups = duplicateSlabs(s);
      if (c.body.cardId) dups = dups.filter((g) => g.cardId === c.body.cardId);
      if (c.body.grade !== undefined && c.body.grade !== null) dups = dups.filter((g) => g.grade === Number(c.body.grade));
      if (!dups.length) fail("no_dup", "Aucun doublon gradé à recycler !");
      gain = dups.reduce((n, g) => n + slabValue(g, c.byId), 0); count = dups.length;
      removeSlabs(s, dups);
    } else if (kind === "card_all") {
      const id = String(c.body.cardId || "");
      if (!c.byId.has(id)) fail("bad_card", "Carte inconnue.");
      normalDups(id);
      const dups = duplicateSlabs(s).filter((g) => g.cardId === id);
      gain += dups.reduce((n, g) => n + slabValue(g, c.byId), 0); count += dups.length;
      removeSlabs(s, dups);
      if (!count) fail("no_dup", "Aucun doublon à recycler !");
    } else fail("bad_request", "Type de recyclage inconnu.");
    s.coins += gain;
    return { result: { gain, count } };
  },

  /* ----- Mini-jeux Pixel / Zoom : la manche (et sa réponse) reste côté serveur ----- */
  game_start: (s, c) => {
    const mode = String(c.body.mode);
    if (mode !== "pixel" && mode !== "zoom") fail("bad_request", "Mode inconnu.");
    if (s.games[mode] >= GAME_DAILY_PLAYS) fail("no_plays", "Plus de parties aujourd'hui pour ce jeu, reviens demain !");
    if (c.list.length < 4) fail("bad_request", "Pas assez de cartes pour jouer.");
    const target = pick(c.list);
    const options = shuffle([target, ...shuffle(c.list.filter((x) => x.id !== target.id)).slice(0, 3)]);
    let params: any, reward: number;
    if (mode === "pixel") { const cells = pick(PIXEL_CELLS); params = { cells }; reward = PIXEL_REWARD[String(cells)]; }
    else { const frac = pick(ZOOM_FRACS); params = { frac, x: rnd(), y: rnd() }; reward = ZOOM_REWARD[String(frac)]; }
    s.games[mode] += 1;                       // la partie est comptée dès le début
    const roundId = crypto.randomUUID();
    s._pending = { ...(s._pending || {}), [mode]: { roundId, cardId: target.id, reward } };
    return { result: { roundId, mode, target: target.id, options: options.map((o) => ({ id: o.id, name: o.name })), params, reward } };
  },

  game_answer: (s, c) => {
    const mode = String(c.body.mode);
    const p = s._pending?.[mode];
    if (!p || p.roundId !== c.body.roundId) fail("no_round", "Cette manche n'existe plus.");
    delete s._pending[mode];
    const ok = String(c.body.cardId) === p.cardId;
    let gems = 0;
    if (ok) {
      s.coins += p.reward;
      if (rnd() < GEM_DROP_CHANCE) { gems = 1 + rint(3); s.gems += gems; }
    }
    const name = c.byId.get(p.cardId)?.name ?? "";
    return { result: { ok, correctId: p.cardId, name, reward: ok ? p.reward : 0, gems } };
  },

  bet: (s, c) => {
    const bet = Number(c.body.bet), index = Number(c.body.pick);
    if (!BET_OPTIONS.includes(bet) || ![0, 1, 2].includes(index)) fail("bad_request", "Mise invalide.");
    if (s.coins < bet) fail("no_coins", "Pas assez de pièces pour cette mise.");
    s.coins -= bet;
    const win = rint(3);
    const gain = index === win ? Math.round(bet * BET_MULT) : 0;
    s.coins += gain;
    return { result: { win, picked: index, bet, gain } };
  },

  /* ----- Bonus Discord ----- */
  claim_discord_bonus: async (s, c) => {
    const discordId = c.user.user_metadata?.provider_id;
    if (!discordId) fail("error", "Compte non lié à Discord.");
    if (s.discordBonus) return { result: { status: "already" } };
    // La ligne bonus_claims garde une trace par compte Discord ; un doublon n'empêche pas le versement si la sauvegarde n'a pas le bonus
    const { error } = await db.from("bonus_claims").insert({ discord_id: String(discordId), bonus: "discord_login" });
    if (error && error.code !== "23505") { console.error(error); fail("error", "Erreur d'enregistrement du bonus."); }
    s.discordBonus = true; s.discordGems = true; s.coins += DISCORD_BONUS; s.gems += DISCORD_GEMS;
    return { result: { status: "ok", coins: DISCORD_BONUS, gems: DISCORD_GEMS } };
  },

  claim_server_bonus: async (s, c) => {
    const discordId = c.user.user_metadata?.provider_id;
    if (!discordId) fail("error", "Compte non lié à Discord.");
    if (s.serverBonus) return { result: { status: "already" } };
    const botToken = Deno.env.get("DISCORD_BOT_TOKEN");
    if (!botToken) fail("error", "Bonus indisponible (configuration serveur).");
    const r = await fetch(`https://discord.com/api/v10/guilds/${GUILD_ID}/members/${discordId}`, {
      headers: { Authorization: `Bot ${botToken}`, "User-Agent": "TCGIsekazBot (https://lazynk.github.io/tcgisekaz, 1.0)" },
    });
    if (r.status === 404) return { result: { status: "not_member" } };
    if (!r.ok) { console.error("Discord API", r.status, await r.text()); fail("error", "Vérification Discord impossible pour le moment."); }
    const { data: existing } = await db.from("bonus_claims").select("discord_id")
      .eq("discord_id", String(discordId)).eq("bonus", "server_join").maybeSingle();
    if (!existing) {
      const { error } = await db.from("bonus_claims").insert({ discord_id: String(discordId), bonus: "server_join" });
      if (error && error.code !== "23505") { console.error(error); fail("error", "Erreur d'enregistrement du bonus."); }
    }
    s.serverBonus = true; s.serverGems = true; s.coins += SERVER_BONUS; s.gems += SERVER_GEMS;
    return { result: { status: "ok", coins: SERVER_BONUS, gems: SERVER_GEMS } };
  },
};

/* ---------------- Lecture / écriture de la sauvegarde (verrou optimiste par version) ---------------- */
async function loadSave(userId: string) {
  const { data, error } = await db.from("saves").select("data, version").eq("user_id", userId).maybeSingle();
  if (error) throw new Error("lecture sauvegarde : " + error.message);
  return data as { data: any; version: number } | null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  try {
    const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    const { data: { user } } = await db.auth.getUser(jwt);
    if (!user) return json({ ok: false, error: "unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const handler = handlers[action];
    if (!handler) return json({ ok: false, error: "bad_request", message: "Action inconnue." });

    const { list, byId } = await cards();
    const ctx: Ctx = { user, byId, list, body };

    for (let attempt = 0; attempt < 5; attempt++) {
      let row = await loadSave(user.id);
      let s: any;
      let created = false, imported = false;
      if (!row) {
        // Premier passage : on crée la sauvegarde (progression d'invité importée, plafonnée)
        imported = action === "sync" && !!body.guest;
        s = imported ? sanitizeImport(body.guest, byId) : freshState();
        created = true;
        const { error } = await db.from("saves").insert({ user_id: user.id, data: s, version: 1 });
        if (error && error.code !== "23505") throw new Error("création sauvegarde : " + error.message);
        row = await loadSave(user.id);
        if (!row) continue;
      }
      s = normalize(structuredClone(row.data));
      let out: Out;
      try {
        out = await handler(s, ctx);
      } catch (e) {
        if (e instanceof GameError) return json({ ok: false, error: e.code, message: e.message, state: publicState(s), now: Date.now(), day: parisDay() });
        throw e;
      }
      const completeGems = awardComplete(s, byId);
      const { data: updated, error } = await db.from("saves")
        .update({ data: s, version: row.version + 1, updated_at: new Date().toISOString() })
        .eq("user_id", user.id).eq("version", row.version).select("version");
      if (error) throw new Error("écriture sauvegarde : " + error.message);
      if (!updated?.length) continue;     // quelqu'un a modifié la sauvegarde entre-temps : on réessaie
      return json({ ok: true, state: publicState(s), now: Date.now(), day: parisDay(), result: out.result ?? {}, completeGems, created, imported });
    }
    return json({ ok: false, error: "busy", message: "Serveur occupé, réessaie dans un instant." });
  } catch (e) {
    console.error(e);
    return json({ ok: false, error: "server", message: "Erreur serveur, réessaie dans un instant." });
  }
});
