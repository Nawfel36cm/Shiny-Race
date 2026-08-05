/* =====================================================================
   rom.js — toute la logique de lecture / modification de ROM GBA.
   Aucune dépendance : ce fichier peut être testé seul sous Node.
   ===================================================================== */

const GAMES = {
  AXV: 'Pokémon Rubis', AXP: 'Pokémon Saphir', BPE: 'Pokémon Émeraude',
  BPR: 'Pokémon Rouge Feu', BPG: 'Pokémon Vert Feuille'
};
const REGIONS = {
  E: 'USA', F: 'France', P: 'Europe', D: 'Allemagne',
  I: 'Italie', S: 'Espagne', J: 'Japon'
};

/* ---------------------------------------------------------------- *
 *  En-tête GBA                                                     *
 * ---------------------------------------------------------------- */
function readHeader(rom) {
  if (rom.length < 0x1000 || rom[0xB2] !== 0x96) return null;
  const txt = (o, n) => String.fromCharCode(...rom.slice(o, o + n)).replace(/\0/g, '').trim();
  const code = txt(0xAC, 4);
  return {
    title: txt(0xA0, 12),
    code,
    game: GAMES[code.slice(0, 3)] || null,
    region: REGIONS[code[3]] || code[3],
    version: rom[0xBC],
    size: rom.length
  };
}

/* ---------------------------------------------------------------- *
 *  Taux de shiny                                                   *
 *                                                                  *
 *  Gen 3 : shiny si  (OTID_hi ^ OTID_lo ^ PID_hi ^ PID_lo) < 8.    *
 *  En THUMB ça donne  cmp Rd,#7 / bhi  ou  cmp Rd,#8 / bcs,        *
 *  précédé de plusieurs EOR et d'au moins un LSR #16.              *
 *  On cherche cette signature au lieu d'adresses en dur : ça       *
 *  fonctionne sur toutes les versions et toutes les langues.       *
 * ---------------------------------------------------------------- */
const SHINY_RATES = [
  { label: '1/8192', count: 8 },  { label: '1/4096', count: 16 },
  { label: '1/2048', count: 32 }, { label: '1/1024', count: 64 },
  { label: '1/512',  count: 128 },{ label: '1/256',  count: 256 }
];

/* Taux libre. Le jeu tire un PID sur 16 bits ; il est shiny quand la valeur
   comparee est inferieure a `count`, soit une chance sur 65536/count.
   L'immediat d'un `cmp` THUMB tient sur un octet, d'ou le plafond a 256. */
const RATE_MAX_COUNT = 256;

/** Denominateur voulu (ex. 256 pour 1/256) -> nombre de valeurs favorables. */
function countFromDenominator(denom) {
  const d = Math.max(1, Math.round(Number(denom) || 0));
  const wanted = Math.round(65536 / d);
  const count = Math.min(RATE_MAX_COUNT, Math.max(1, wanted));
  return {
    count,
    wanted,
    denomAsked: d,
    denomReal: Math.round(65536 / count),
    capped: wanted > RATE_MAX_COUNT
  };
}

function findShinyChecks(b) {
  const out = [];
  for (let i = 0; i < b.length - 6; i += 2) {
    const op = b[i + 1];
    if (op < 0x28 || op > 0x2F) continue;              // cmp Rd, #imm8
    let form = null;
    if (b[i] === 0x07 && b[i + 3] === 0xD8) form = 'le';       // shiny si <= 7
    else if (b[i] === 0x08 && b[i + 3] === 0xD2) form = 'lt';  // shiny si <  8
    if (!form) continue;

    let eor = 0, lsr = 0;
    for (let j = Math.max(0, i - 48); j < i; j += 2) {
      if (b[j + 1] === 0x40 && b[j] >= 0x40 && b[j] <= 0x7F) eor++;  // EOR Rd,Rm
      if (b[j + 1] === 0x0C) lsr++;                                  // LSR Rd,Rm,#16
    }
    if (eor < 2) continue;
    out.push({ off: i, reg: op - 0x28, form, old: b[i], conf: lsr ? 'forte' : 'moyenne' });
  }
  return out;
}

/** Renvoie la liste des octets à écrire pour atteindre le taux voulu. */
function shinyPatches(hits, count) {
  const list = [];
  for (const h of hits) {
    let imm = h.form === 'le' ? count - 1 : count;
    const capped = imm > 255;
    if (capped) imm = 255;
    if (imm !== h.old) list.push({ off: h.off, value: imm, hit: h, capped });
  }
  return list;
}

/* ---------------------------------------------------------------- *
 *  Rencontres sauvages                                             *
 *                                                                  *
 *  struct WildPokemonHeader (20 o) :                               *
 *      u8 mapGroup, u8 mapNum, u16 pad,                            *
 *      ptr land, ptr water, ptr rockSmash, ptr fishing             *
 *  Table terminée par mapGroup = mapNum = 0xFF.                    *
 *                                                                  *
 *  struct WildPokemonInfo (8 o) : u8 rate, u8 pad[3], ptr mons     *
 *  struct WildPokemon (4 o)    : u8 minLvl, u8 maxLvl, u16 species *
 * ---------------------------------------------------------------- */
const SLOTS = { land: 12, water: 5, rock: 5, fish: 10 };
const HEADER_SIZE = 20;

const rd32 = (b, o) => (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
const isPtr = (b, o) => { const w = rd32(b, o); return b[o + 3] === 0x08 && (w - 0x08000000) >>> 0 < b.length; };
const deref = (b, o) => (rd32(b, o) - 0x08000000) >>> 0;

function findEncounterTable(b) {
  let best = null;
  for (let i = 0x100000; i < b.length - HEADER_SIZE; i += 4) {
    let p = i, n = 0, bad = false;
    while (p + HEADER_SIZE <= b.length) {
      if (b[p] === 0xFF && b[p + 1] === 0xFF) break;
      if (b[p + 2] !== 0 || b[p + 3] !== 0) { bad = true; break; }
      let ptrs = 0;
      for (let k = 0; k < 4; k++) {
        const o = p + 4 + k * 4;
        const w = rd32(b, o);
        if (w === 0) continue;
        if (!isPtr(b, o)) { bad = true; break; }
        ptrs++;
      }
      if (bad || ptrs === 0) { bad = true; break; }
      n++; p += HEADER_SIZE;
      if (n > 600) { bad = true; break; }
    }
    if (!bad && n >= 40 && b[p] === 0xFF && b[p + 1] === 0xFF) {
      if (!best || n > best.count) best = { start: i, count: n };
      i = p;                                    // on saute la table trouvée
    }
  }
  return best;
}

/** Extrait tous les emplacements d'espèces modifiables. */
function readEncounters(b, table) {
  const out = [];
  for (let h = 0; h < table.count; h++) {
    const base = table.start + h * HEADER_SIZE;
    const map = `${b[base]}.${b[base + 1]}`;
    ['land', 'water', 'rock', 'fish'].forEach((kind, k) => {
      const po = base + 4 + k * 4;
      if (rd32(b, po) === 0) return;
      const info = deref(b, po);
      if (!isPtr(b, info + 4)) return;
      const mons = deref(b, info + 4);
      for (let s = 0; s < SLOTS[kind]; s++) {
        const e = mons + s * 4;
        if (e + 4 > b.length) return;
        out.push({ map, kind, off: e, min: b[e], max: b[e + 1], species: b[e + 2] | b[e + 3] << 8 });
      }
    });
  }
  return out;
}

/* Indices internes valides en gen 3 : 1–251 puis 277–411.
   Les slots 252–276 sont des entrées inutilisées (glitch). */
const VALID_SPECIES = (() => {
  const a = [];
  for (let i = 1; i <= 251; i++) a.push(i);
  for (let i = 277; i <= 411; i++) a.push(i);
  return a;
})();

/** PRNG déterministe : même graine = même ROM, pour des races reproductibles. */
function rng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = h << 13 | h >>> 19;
  }
  let s = h >>> 0;
  return () => {
    s = s + 0x6D2B79F5 | 0;
    let t = Math.imul(s ^ s >>> 15, 1 | s);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * @param mode  'full'   un tirage indépendant par emplacement
 *              'global' une correspondance espèce → espèce valable partout
 *              'area'   une correspondance différente par zone
 */
function randomizeEncounters(list, { mode = 'global', seed = 'race', noDupes = true }) {
  const rand = rng(seed);
  const pick = () => VALID_SPECIES[Math.floor(rand() * VALID_SPECIES.length)];
  const maps = new Map();
  const global = new Map();
  const writes = [];

  for (const e of list) {
    let sp;
    if (mode === 'full') sp = pick();
    else {
      const key = mode === 'global' ? global : (maps.get(e.map) || maps.set(e.map, new Map()).get(e.map));
      if (!key.has(e.species)) key.set(e.species, pick());
      sp = key.get(e.species);
    }
    writes.push({ off: e.off, species: sp, from: e.species, map: e.map, kind: e.kind });
  }

  if (noDupes && mode === 'full') {
    const seen = new Map();
    for (const w of writes) {
      const k = w.map + w.kind;
      if (!seen.has(k)) seen.set(k, new Set());
      const set = seen.get(k);
      let guard = 0;
      while (set.has(w.species) && guard++ < 60) w.species = pick();
      set.add(w.species);
    }
  }
  return writes;
}

/* ---------------------------------------------------------------- *
 *  Starters                                                        *
 *                                                                  *
 *  Les trois especes de depart sont stockees cote a cote, en u16,   *
 *  dans les indices internes de la generation 3. On les repere par  *
 *  leur suite d'octets plutot que par une adresse : le meme code    *
 *  marche sur toutes les versions et toutes les langues.            *
 * ---------------------------------------------------------------- */
const STARTER_SETS = [
  { id: 'rse',  label: 'Arcko, Poussifeu, Gobou',         species: [277, 280, 283],
    codes: ['AXV', 'AXP', 'BPE'] },
  { id: 'frlg', label: 'Bulbizarre, Salameche, Carapuce', species: [1, 4, 7],
    codes: ['BPR', 'BPG'] }
];

/* Au-dela de ce nombre d'occurrences, la suite d'octets est trop banale
   pour etre la table des starters : on refuse plutot que de corrompre. */
const STARTER_MAX_HITS = 12;

/* Le jeu est identifie par son code d'en-tete, pas en essayant les
   signatures a l'aveugle : sur une ROM Rouge Feu, les six octets des
   starters d'Emeraude peuvent apparaitre par hasard, et on patcherait
   alors du remplissage au lieu de la vraie table. */
function findStarters(b, code) {
  /* L'en-tete porte quatre caracteres : trois pour le jeu, un pour la
     langue (BPRE, BPRF, BPRD...). On ne compare que les trois premiers,
     pour couvrir toutes les langues d'un meme jeu. */
  const key = String(code || '').slice(0, 3).toUpperCase();
  const wanted = key ? STARTER_SETS.filter(x => x.codes.includes(key)) : [];
  const list = wanted.length ? wanted : STARTER_SETS;
  let lastTried = null;

  for (const set of list) {
    const pat = [];
    for (const sp of set.species) pat.push(sp & 0xFF, sp >> 8 & 0xFF);

    const offs = [];
    for (let i = 0; i + pat.length <= b.length; i += 2) {
      let ok = true;
      for (let k = 0; k < pat.length; k++) if (b[i + k] !== pat[k]) { ok = false; break; }
      if (ok) offs.push(i);
      if (offs.length > STARTER_MAX_HITS) break;
    }
    if (!offs.length) { lastTried = set; continue; }
    return {
      set: set.id,
      code: code || '?',
      label: set.label,
      species: set.species.slice(),
      offsets: offs,
      tooMany: offs.length > STARTER_MAX_HITS
    };
  }
  return lastTried ? { missing: true, label: lastTried.label, code: code || '?' } : null;
}

/** Tire trois especes distinctes et rend les octets a ecrire. */
function randomizeStarters(found, seed) {
  if (!found || found.tooMany || found.missing) return { writes: [], species: [] };
  const rand = rng('starters:' + seed);
  const picked = [];
  let guard = 0;
  while (picked.length < 3 && guard++ < 400) {
    const sp = VALID_SPECIES[Math.floor(rand() * VALID_SPECIES.length)];
    if (!picked.includes(sp)) picked.push(sp);
  }
  const writes = [];
  for (const off of found.offsets) {
    picked.forEach((sp, k) => {
      writes.push({ off: off + k * 2, lo: sp & 0xFF, hi: sp >> 8 & 0xFF, species: sp });
    });
  }
  return { writes, species: picked };
}

function applyStarters(rom, writes) {
  for (const w of writes) { rom[w.off] = w.lo; rom[w.off + 1] = w.hi; }
}

function applyEncounters(rom, writes) {
  for (const w of writes) {
    rom[w.off + 2] = w.species & 0xFF;
    rom[w.off + 3] = w.species >> 8 & 0xFF;
  }
}

/* ---------------------------------------------------------------- *
 *  Export IPS — permet de partager la modif sans partager la ROM   *
 * ---------------------------------------------------------------- */
function buildIPS(rom, patched) {
  const out = [...'PATCH'].map(c => c.charCodeAt(0));
  let i = 0;
  while (i < rom.length) {
    if (rom[i] === patched[i]) { i++; continue; }
    const start = i;
    let gap = 0;
    while (i < rom.length && gap < 6) { if (rom[i] === patched[i]) gap++; else gap = 0; i++; }
    const end = i - gap;
    for (let c = start; c < end; c += 0xFFFF) {
      const len = Math.min(0xFFFF, end - c);
      out.push(c >> 16 & 255, c >> 8 & 255, c & 255, len >> 8 & 255, len & 255);
      for (let k = 0; k < len; k++) out.push(patched[c + k]);
    }
  }
  out.push(...[...'EOF'].map(c => c.charCodeAt(0)));
  return new Uint8Array(out);
}

async function sha1(buffer) {
  const d = await crypto.subtle.digest('SHA-1', buffer);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Exposition globale : Electron charge les pages en file://, où les modules
   ES sont bloqués par Chromium. On reste donc sur de simples scripts. */
window.ROM = {
  GAMES, REGIONS, SHINY_RATES, VALID_SPECIES, RATE_MAX_COUNT, countFromDenominator,
  readHeader, findShinyChecks, shinyPatches,
  findEncounterTable, readEncounters, randomizeEncounters, applyEncounters,
  findStarters, randomizeStarters, applyStarters, STARTER_SETS,
  rng, buildIPS, sha1
};
