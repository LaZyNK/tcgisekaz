const RARITY_CONFIG = {
  C:   { label: "Commune",     weight: 55, recycleValue: 2 },
  UC:  { label: "Peu Commune", weight: 28, recycleValue: 6 },
  R:   { label: "Rare",        weight: 12, recycleValue: 20 },
  UR:  { label: "Ultra Rare",  weight: 4,  recycleValue: 60 },
  SEC: { label: "Secrète",     weight: 1,  recycleValue: 150 }
};

// Catalogue des cartes : ajoute tes visuels dans "image" (ex: "assets/carte01.png")
const CARD_DATABASE = [
  { id: "001", name: "Louveteau Astral",     rarity: "C",   emoji: "🐺", bg: "linear-gradient(135deg, #1e293b, #334155)", image: "" },
  { id: "002", name: "Feu Follet Sylvestre", rarity: "C",   emoji: "🌿", bg: "linear-gradient(135deg, #14532d, #166534)", image: "" },
  { id: "003", name: "Golem de Basalte",     rarity: "C",   emoji: "🪨", bg: "linear-gradient(135deg, #3f3f46, #52525b)", image: "" },
  { id: "004", name: "Étincelle Errante",    rarity: "C",   emoji: "✨", bg: "linear-gradient(135deg, #713f12, #854d0e)", image: "" },
  { id: "005", name: "Sentinelle d'Acier",   rarity: "UC",  emoji: "🛡️", bg: "linear-gradient(135deg, #064e3b, #047857)", image: "" },
  { id: "006", name: "Chasseur Crépuscule",  rarity: "UC",  emoji: "🏹", bg: "linear-gradient(135deg, #1e3a8a, #1d4ed8)", image: "" },
  { id: "007", name: "Alchimiste Lunaire",   rarity: "UC",  emoji: "🧪", bg: "linear-gradient(135deg, #4c1d95, #6d28d9)", image: "" },
  { id: "008", name: "Chevalier du Néant",   rarity: "R",   emoji: "⚔️", bg: "linear-gradient(135deg, #0c4a6e, #0284c7)", image: "" },
  { id: "009", name: "Dragon des Cendres",   rarity: "R",   emoji: "🐉", bg: "linear-gradient(135deg, #7f1d1d, #dc2626)", image: "" },
  { id: "010", name: "Archimage Céleste",    rarity: "UR",  emoji: "🔮", bg: "linear-gradient(135deg, #581c87, #c026d3)", image: "" },
  { id: "011", name: "Valkyrie Solaire",     rarity: "UR",  emoji: "🪽", bg: "linear-gradient(135deg, #7c2d12, #ea580c)", image: "" },
  { id: "012", name: "Cerf Lunaire Alpha",   rarity: "SEC", emoji: "🦌", bg: "linear-gradient(135deg, #311042, #facc15)", image: "" }
  
];

const EDITIONS = {
  E1: { name: "ORIGINES",  tag: "ÉDITION 01", gradient: "linear-gradient(135deg, #3b82f6 0%, #8b5cf6 50%, #ec4899 100%)" },
  E2: { name: "DESTINEE FATALE", tag: "ÉDITION 02", gradient: "linear-gradient(135deg, #10b981 0%, #0ea5e9 50%, #6366f1 100%)" },
  E3: { name: "MONDE INVERSEE", tag: "ÉDITION 03", gradient: "linear-gradient(135deg, #f59e0b 0%, #ef4444 50%, #7c3aed 100%)" }
};

// Les cartes sans édition appartiennent à l'édition 1
CARD_DATABASE.forEach(c => { c.edition = c.edition || "E1"; });
