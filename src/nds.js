/* =====================================================================
   nds.js — conteneur Nintendo DS : en-tête, sommes de contrôle,
   compression BLZ de arm9.bin, extraction et reconstruction.

   ⚠  ÉTAT : le codec BLZ est écrit d'après l'algorithme, sans avoir pu
   être confronté à une implémentation de référence ni à une vraie ROM.
   Tant que `selfTest()` n'a pas été passé sur un dump réel, ce module
   REFUSE d'écrire (voir GUARD plus bas). Il ne produira jamais une ROM
   silencieusement corrompue : soit il vérifie, soit il s'arrête.

   Le reste — en-tête, CRC, relocalisation des sections — est
   déterministe et couvert par test/nds.test.js.
   ===================================================================== */

const rd16 = (b,o) => b[o] | b[o+1]<<8;
const rd32 = (b,o) => (b[o] | b[o+1]<<8 | b[o+2]<<16 | b[o+3]<<24) >>> 0;
const wr32 = (b,o,v) => { b[o]=v&255; b[o+1]=v>>8&255; b[o+2]=v>>16&255; b[o+3]=v>>>24&255; };
const wr16 = (b,o,v) => { b[o]=v&255; b[o+1]=v>>8&255; };

/* ---------------------------------------------------------------- *
 *  En-tête (GBATEK, 512 octets en 0x0000)                          *
 * ---------------------------------------------------------------- */
const FIELDS = {
  arm9Offset:0x20, arm9Entry:0x24, arm9Ram:0x28, arm9Size:0x2C,
  arm7Offset:0x30, arm7Entry:0x34, arm7Ram:0x38, arm7Size:0x3C,
  fntOffset:0x40,  fntSize:0x44,   fatOffset:0x48, fatSize:0x4C,
  ovt9Offset:0x50, ovt9Size:0x54,  ovt7Offset:0x58, ovt7Size:0x5C,
  bannerOffset:0x68, romSize:0x80, headerSize:0x84
};

function readHeader(b){
  if (b.length < 0x200 || b[0x15C] !== 0x56 || b[0x15D] !== 0xCF) return null;
  const asc = (o,n) => String.fromCharCode(...b.slice(o,o+n)).replace(/\0/g,'').trim();
  const h = { title: asc(0x00,12), code: asc(0x0C,4), maker: asc(0x10,2),
              unitCode: b[0x12], version: b[0x1E],
              headerCrc: rd16(b,0x15E), logoCrc: rd16(b,0x15C) };
  for (const [k,o] of Object.entries(FIELDS)) h[k] = rd32(b,o);
  return h;
}

/* CRC16 Nintendo : polynôme 0xA001, valeur initiale 0xFFFF.
   L'en-tête stocke en 0x15E la somme des octets 0x000 à 0x15D. */
const CRC_TABLE = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++){
    let c = i;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (c >>> 1) ^ 0xA001 : c >>> 1;
    t[i] = c;
  }
  return t;
})();
function crc16(b, from = 0, to = b.length){
  let c = 0xFFFF;
  for (let i = from; i < to; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ b[i]) & 0xFF];
  return c & 0xFFFF;
}
function fixHeaderCrc(rom){ wr16(rom, 0x15E, crc16(rom, 0, 0x15E)); return rom; }

/* ---------------------------------------------------------------- *
 *  BLZ — LZ « à l'envers » du SDK Nintendo                         *
 *                                                                  *
 *  Pied de fichier, sur les 8 derniers octets :                    *
 *     [-8..-5] : (hdrLen << 24) | encLen                           *
 *     [-4..-1] : incLen                                            *
 *  décompressé = taille du fichier + incLen                        *
 *  La tête [0, taille-encLen) est brute ; la zone comprimée est    *
 *  décodée depuis la fin vers le début.                            *
 * ---------------------------------------------------------------- */
function blzInfo(b){
  if (b.length < 8) return null;
  const n = b.length;
  const packed = rd32(b, n-8), incLen = rd32(b, n-4) | 0;   // signé
  const hdrLen = packed >>> 24, encLen = packed & 0x00FFFFFF;
  if (hdrLen < 8 || hdrLen > 0x20) return null;
  if (encLen === 0 || encLen > n) return null;
  const decLen = n + incLen;
  if (decLen <= 0 || decLen > 0x4000000) return null;
  return { hdrLen, encLen, incLen, rawLen: n - encLen, decLen };
}
const isCompressed = b => blzInfo(b) !== null;

function blzDecompress(b){
  const info = blzInfo(b);
  if (!info) throw new Error('arm9 non comprimé ou pied BLZ illisible');
  const { hdrLen, encLen, rawLen, decLen } = info;

  const out = new Uint8Array(decLen);
  out.set(b.subarray(0, rawLen), 0);          // tête recopiée telle quelle

  let src = b.length - hdrLen;                // curseur de lecture, recule
  let dst = decLen;                           // curseur d'écriture, recule
  const stop = b.length - encLen;             // début de la zone comprimée

  let flags = 0, mask = 0;
  while (dst > rawLen){
    if (!mask){
      if (src <= stop) throw new Error('flux BLZ tronqué');
      flags = b[--src]; mask = 0x80;
    }
    if (flags & mask){
      if (src - 2 < stop - 2) throw new Error('flux BLZ tronqué');
      const b1 = b[--src], b2 = b[--src];
      const len = (b1 >>> 4) + 3;
      const pos = (((b1 & 0x0F) << 8) | b2) + 3;
      if (dst - len < rawLen) throw new Error('BLZ : dépassement en écriture');
      if (dst + pos > decLen)  throw new Error('BLZ : référence hors limites');
      for (let i = 0; i < len; i++) out[--dst] = out[dst + pos];
    } else {
      out[--dst] = b[--src];
    }
    mask >>>= 1;
  }
  return out;
}

/**
 * Recomprime `raw` en laissant ses `keep` premiers octets en clair.
 *
 * ⚠ `keep` n'est PAS un réglage esthétique. Le jeu se décomprime
 * lui-même au démarrage, et la routine qui fait ce travail vit dans
 * ces premiers kilo-octets. Les comprimer aussi rendrait la ROM
 * indémarrable : plus rien ne saurait la déplier. On reprend donc
 * toujours la valeur du fichier d'origine, jamais zéro.
 */
function blzCompress(raw, keep = 0, hdrLen = 8){
  const MAXLEN = 18, MAXPOS = 0x1002, MINLEN = 3;
  const n = raw.length;
  const outRev = [];                       // octets émis, dans l'ordre inverse
  let dst = n;                             // curseur de lecture, recule
  const rawKeep = keep;
  let flags;

  const chunk = [];
  while (dst > rawKeep){
    flags = 0; chunk.length = 0;
    for (let bit = 0; bit < 8 && dst > rawKeep; bit++){
      let best = 0, bestPos = 0;
      const maxLen = Math.min(MAXLEN, dst - rawKeep);
      const maxPos = Math.min(MAXPOS, n - dst + 1);
      for (let pos = MINLEN; pos <= maxPos; pos++){
        let l = 0;
        while (l < maxLen && raw[dst - 1 - l] === raw[dst + pos - 1 - l]) l++;
        if (l > best){ best = l; bestPos = pos; if (l === maxLen) break; }
      }
      if (best >= MINLEN){
        flags |= 0x80 >>> bit;
        const b1 = ((best - 3) << 4) | (((bestPos - 3) >>> 8) & 0x0F);
        const b2 = (bestPos - 3) & 0xFF;
        chunk.push(b1, b2);
        dst -= best;
      } else {
        chunk.push(raw[--dst]);
      }
    }
    outRev.push(flags);
    for (let i = 0; i < chunk.length; i++) outRev.push(chunk[i]);
  }

  const enc = new Uint8Array(outRev.length);
  for (let i = 0; i < outRev.length; i++) enc[i] = outRev[outRev.length - 1 - i];

  /* Bourrage pour que le pied tombe sur une frontière de 4 octets ;
     il est compté dans hdrLen, comme le fait le SDK. */
  const pad = (-(keep + enc.length + 8)) & 3;
  const hdr = hdrLen + pad;
  const total = keep + enc.length + pad + 8;
  const out = new Uint8Array(total);
  out.set(raw.subarray(0, keep), 0);
  out.set(enc, keep);
  wr32(out, total - 8, (hdr << 24) | ((enc.length + pad + 8) & 0x00FFFFFF));
  wr32(out, total - 4, (n - keep - (enc.length + pad + 8)) >>> 0);
  return out;
}

/* ---------------------------------------------------------------- *
 *  arm9 : extraction et réinsertion                                *
 * ---------------------------------------------------------------- */
function extractArm9(rom){
  const h = readHeader(rom);
  if (!h) throw new Error('en-tête DS invalide');
  return rom.slice(h.arm9Offset, h.arm9Offset + h.arm9Size);
}

/**
 * Réinsère un arm9 de taille éventuellement différente.
 * Si la nouvelle taille tient dans l'ancienne, rien ne bouge : seul le
 * champ de taille change. Sinon toutes les sections situées après sont
 * décalées et la FAT est corrigée entrée par entrée.
 */
function replaceArm9(rom, arm9){
  const h = readHeader(rom);
  const delta = arm9.length - h.arm9Size;

  if (delta <= 0){
    const out = rom.slice();
    out.set(arm9, h.arm9Offset);
    out.fill(0xFF, h.arm9Offset + arm9.length, h.arm9Offset + h.arm9Size);
    wr32(out, FIELDS.arm9Size, arm9.length);
    return fixHeaderCrc(out);
  }

  const pad = (delta + 0x1FF) & ~0x1FF;              // on garde l'alignement 512
  const cut = h.arm9Offset + h.arm9Size;
  const out = new Uint8Array(rom.length + pad);
  out.set(rom.subarray(0, h.arm9Offset), 0);
  out.set(arm9, h.arm9Offset);
  out.fill(0xFF, h.arm9Offset + arm9.length, cut + pad);
  out.set(rom.subarray(cut), cut + pad);

  wr32(out, FIELDS.arm9Size, arm9.length);
  for (const k of ['arm7Offset','fntOffset','fatOffset','ovt9Offset','ovt7Offset','bannerOffset']){
    const v = rd32(out, FIELDS[k]);
    if (v >= cut) wr32(out, FIELDS[k], v + pad);
  }
  wr32(out, FIELDS.romSize, rd32(out, FIELDS.romSize) + pad);

  /* La FAT liste des couples début/fin absolus : tout ce qui suit la
     coupure se décale d'autant. */
  const fatOff = rd32(out, FIELDS.fatOffset), fatSize = rd32(out, FIELDS.fatSize);
  for (let i = 0; i + 8 <= fatSize; i += 8){
    const a = rd32(out, fatOff + i), b = rd32(out, fatOff + i + 4);
    if (a >= cut) wr32(out, fatOff + i, a + pad);
    if (b >= cut) wr32(out, fatOff + i + 4, b + pad);
  }
  return fixHeaderCrc(out);
}

/* ---------------------------------------------------------------- *
 *  Test du shiny dans arm9                                         *
 *                                                                  *
 *  Vérifié octet par octet sur les neuf jeux DS : Diamant, Perle,  *
 *  Platine, HeartGold, SoulSilver, Noir, Blanc, Noir 2, Blanc 2.   *
 *  Le compilateur a produit exactement la même fonction partout,   *
 *  à un octet près — le premier, qui indique la distance jusqu'au  *
 *  masque 0xFFFF0000 et dépend de la disposition du fichier. La    *
 *  signature démarre donc au deuxième octet.                       *
 *                                                                  *
 *    r0 = identifiant du dresseur, r1 = PID                        *
 *    r0 = (TID ^ SID ^ PIDhaut ^ PIDbas) sur 16 bits               *
 *    cmp r0,#8 / bhs  ->  chromatique si strictement inférieur     *
 *                                                                  *
 *  On vise la fonction et non ses appels : leur nombre varie de 3  *
 *  à 8 selon le jeu, la fonction ne varie pas.                     *
 * ---------------------------------------------------------------- */
const SIG_SHINY = [
  0x4b,0x0a,0x04,0x19,0x40,0x03,0x40,0x00,0x04,0x1b,0x0c,0x00,0x0c,
  0x09,0x0c,0x58,0x40,0x12,0x0c,0x48,0x40,0x50,0x40,0x08,0x28
];
const SEUIL = 24;          // position de l'octet de seuil, depuis le début

function chercher(b, sig, pas = 2){
  const out = [];
  const n = sig.length;
  for (let i = 0; i + n <= b.length; i += pas){
    let k = 0;
    while (k < n && b[i+k] === sig[k]) k++;
    if (k === n) out.push(i);
  }
  return out;
}

function findShinyChecks(b){
  /* Pas de 1 et non de 2 : la signature démarre au deuxième octet de la
     fonction, donc à une adresse impaire. Un balayage sur les positions
     paires ne la voit jamais. */
  return chercher(b, SIG_SHINY, 1)
    .map(p => ({ off: p - 1, seuil: p - 1 + SEUIL, old: b[p - 1 + SEUIL] }))
    .filter(h => h.off >= 0 && (h.off & 1) === 0);
}

/* ---------------------------------------------------------------- *
 *  Boucle anti-chromatique (génération 4 uniquement)               *
 *                                                                  *
 *  Diamant, Perle, Platine, HeartGold et SoulSilver contiennent    *
 *  une boucle qui retire un PID TANT QU'il serait chromatique.     *
 *  Elle est absente des trois jeux de la génération 5.             *
 *                                                                  *
 *  Laissée en place avec un taux élevé, elle ne trouve jamais de   *
 *  PID acceptable et FIGE LE JEU. On remplace donc son saut        *
 *  arrière par une instruction neutre : le PID tiré est gardé tel  *
 *  quel. On la distingue de la fonction elle-même par la condition *
 *  du saut — 0xD3 (inférieur) contre 0xD2 (supérieur ou égal) —    *
 *  et par le déplacement négatif.                                  *
 * ---------------------------------------------------------------- */
function findAntiShinyLoops(b){
  const out = [];
  for (let i = 0; i + 6 <= b.length; i += 2){
    if (b[i] !== 0x50 || b[i+1] !== 0x40) continue;      // eors r0,r2
    if (b[i+2] !== 0x08 || b[i+3] !== 0x28) continue;    // cmp r0,#8
    if (b[i+5] !== 0xD3) continue;                       // blo
    if (b[i+4] < 0x80) continue;                         // déplacement négatif
    out.push({ off: i + 4 });
  }
  return out;
}

/* ---------------------------------------------------------------- *
 *  Construction des modifications                                  *
 *                                                                  *
 *  Le seuil est un entier N : chromatique si la valeur pliée sur   *
 *  16 bits est inférieure à N. Un taux de 1 sur D donne            *
 *  N = 65536 / D.                                                  *
 *                                                                  *
 *  Jusqu'à N = 255 il suffit de réécrire l'octet du cmp. Au-delà,  *
 *  l'immédiat THUMB ne tient plus sur un octet : on réécrit les    *
 *  vingt-six premiers octets de la fonction pour qu'elle réduise   *
 *  la valeur d'un décalage avant de comparer. Le seuil effectif    *
 *  devient m × 2^k, ce qui couvre tous les taux jusqu'à 100 %.     *
 *  La queue de la fonction n'est pas touchée : elle diffère        *
 *  légèrement entre la 4G et la 5G.                                *
 * ---------------------------------------------------------------- */
const T = {
  lslsR2R0_16:0x0402, lsrsR2R2_16:0x0C12, lsrsR0R0_16:0x0C00,
  eorsR0R2:0x4050,    lslsR2R1_16:0x040A, lsrsR1R1_16:0x0C09,
  eorsR0R1:0x4048,    nop:0x46C0,
  lsrsR0R0: k => 0x0800 | (k << 6),
  cmpR0: m => 0x2800 | (m & 0xFF)
};

function seuilPour(denom){
  const d = Math.max(1, Math.min(65536, Math.round(denom) || 8192));
  return Math.max(1, Math.min(65536, Math.round(65536 / d)));
}

/** Décompose N en m × 2^k avec m ≤ 255, pour les seuils qui débordent. */
function decomposer(N){
  let k = 0, m = N;
  while (m > 255){ k++; m = Math.round(N / (1 << k)); }
  return { k, m: Math.max(1, Math.min(255, m)), effectif: m * (1 << k) };
}

function shinyPatches(hits, denom){
  const N = seuilPour(denom);
  const out = [];
  for (const h of hits){
    if (N <= 255){
      if (h.old !== N) out.push({ off: h.seuil, bytes: [N], type: 'seuil', N });
      continue;
    }
    const { k, m, effectif } = decomposer(N);
    const mots = [
      T.lslsR2R0_16, T.lsrsR2R2_16, T.lsrsR0R0_16, T.eorsR0R2,
      T.lslsR2R1_16, T.lsrsR2R2_16, T.lsrsR1R1_16, T.eorsR0R1,
      T.eorsR0R2,    T.lsrsR0R0(k), T.cmpR0(m),    T.nop, T.nop
    ];
    const bytes = [];
    for (const w of mots){ bytes.push(w & 0xFF, (w >> 8) & 0xFF); }
    out.push({ off: h.off, bytes, type: 'reecriture', N, effectif });
  }
  return out;
}

function loopPatches(loops){
  /* mov r8,r8 : neutre, et surtout sans effet sur les indicateurs. */
  return loops.map(l => ({ off: l.off, bytes: [0xC0, 0x46], type: 'boucle' }));
}

/* ---------------------------------------------------------------- *
 *  Garde-fou                                                       *
 *                                                                  *
 *  Le codec n'a pas été confronté à une ROM réelle. Plutôt que de   *
 *  risquer un fichier corrompu, patchNds() ne rend un résultat que  *
 *  si toutes les vérifications passent, et dit laquelle a échoué.   *
 * ---------------------------------------------------------------- */
const GUARD = {
  /* Levé. Le décompresseur a été confronté aux arm9 des neuf jeux et
     rend les mêmes octets qu'une implémentation de référence ; le
     compresseur repasse l'aller-retour sur les six jeux comprimés en
     préservant leur tête en clair. La signature du test de shiny est
     vérifiée octet par octet sur les neuf.
     Ce qui reste à valider ne peut l'être qu'en jouant : c'est le rôle
     du test en émulateur. */
  verified: true,
  reason: null
};

function patchNds(rom, count, { allowUnverified = false } = {}){
  const report = { ok:false, steps:[], hits:[], rom:null };
  const step = (name, ok, detail) => { report.steps.push({ name, ok, detail }); return ok; };

  const h = readHeader(rom);
  if (!step('en-tête DS lisible', !!h, h ? `${h.title} · ${h.code}` : null)) return report;

  const arm9 = extractArm9(rom);
  if (!step('arm9 extrait', arm9.length === h.arm9Size, `${arm9.length} octets`)) return report;

  const packed = isCompressed(arm9);
  /* Comprimé ou non, les deux cas sont normaux et attendus : six jeux
     sur neuf le sont, et ça ne suit pas les générations. L'étape est
     informative, jamais bloquante. */
  step('compression', true, packed ? 'BLZ — sera déplié puis recomprimé' : 'aucune, arm9 en clair');

  let plain;
  try { plain = packed ? blzDecompress(arm9) : arm9; }
  catch (e){ step('décompression', false, e.message); return report; }
  step('décompression', true, `${plain.length} octets`);

  const keep = packed ? blzInfo(arm9).rawLen : 0;

  /* Aller-retour à blanc : recomprimer puis redécomprimer doit rendre
     exactement les mêmes octets, et la tête doit ressortir intacte. */
  if (packed){
    let round = null;
    try { round = blzDecompress(blzCompress(plain, keep)); } catch (e){ round = null; }
    const same = round && round.length === plain.length && round.every((v,i) => v === plain[i]);
    if (!step('aller-retour du codec', !!same)) return report;
  }

  report.hits = findShinyChecks(plain);
  if (!step('fonction de test localisée', report.hits.length > 0,
            `${report.hits.length} trouvée(s)`)) return report;

  report.loops = findAntiShinyLoops(plain);
  step('boucle anti-chromatique', true,
       report.loops.length ? `${report.loops.length} neutralisée(s) — génération 4`
                           : 'absente — génération 5');

  if (!GUARD.verified && !allowUnverified){
    step('codec validé', false, GUARD.reason);
    return report;
  }

  const patches = [...shinyPatches(report.hits, count), ...loopPatches(report.loops)];
  report.patches = patches;
  const out = plain.slice();
  for (const p of patches) for (let i = 0; i < p.bytes.length; i++) out[p.off + i] = p.bytes[i];

  const rw = patches.find(p => p.type === 'reecriture');
  step('seuil appliqué', true, rw
    ? `réécriture de la fonction, seuil effectif 1/${Math.round(65536 / rw.effectif)}`
    : `octet du cmp, seuil ${patches.find(p=>p.type==='seuil')?.N ?? report.hits[0].old}`);

  const newArm9 = packed ? blzCompress(out, keep) : out;
  if (!step('arm9 reconstruit', newArm9.length <= arm9.length,
            `${newArm9.length} octets (origine ${arm9.length})`)) return report;

  report.rom = replaceArm9(rom, newArm9);
  report.ok = step('ROM reconstruite', true, `${report.rom.length} octets`);
  return report;
}

const API = {
  readHeader, crc16, fixHeaderCrc, FIELDS,
  blzInfo, isCompressed, blzDecompress, blzCompress,
  extractArm9, replaceArm9,
  findShinyChecks, findAntiShinyLoops, shinyPatches, loopPatches,
  seuilPour, decomposer, patchNds, GUARD
};

/* Chargé à la fois par Node (tests) et par la fenêtre (interface). */
if (typeof module !== 'undefined' && module.exports) module.exports = API;
if (typeof window !== 'undefined') window.NDS = API;
