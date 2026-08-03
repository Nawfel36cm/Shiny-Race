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

function blzCompress(raw, hdrLen = 8){
  /* On comprime la queue et on laisse la tête brute, comme le SDK.
     Recherche de correspondances vers l'avant dans les données déjà
     émises (c'est-à-dire vers la fin, puisqu'on travaille à l'envers). */
  const MAXLEN = 18, MAXPOS = 0x1002, MINLEN = 3;
  const n = raw.length;
  const outRev = [];                       // octets émis, dans l'ordre inverse
  let dst = n;                             // curseur de lecture, recule
  const rawKeep = 0;                       // tout est comprimé
  let flagPos, flags, count;

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

  const total = enc.length + hdrLen;
  const out = new Uint8Array(total);
  out.set(enc, 0);
  wr32(out, total - 8, (hdrLen << 24) | (enc.length + hdrLen));
  wr32(out, total - 4, n - total);
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
 *  Même formule qu'en gen 3 : (PID ^ OTID) plié sur 16 bits,       *
 *  comparé à 8. Reste à savoir si le compilateur a émis de l'ARM   *
 *  ou du THUMB : on cherche les deux.                              *
 * ---------------------------------------------------------------- */
function findShinyChecks(b){
  const out = [];

  // THUMB : cmp Rd,#7 / bhi   ou   cmp Rd,#8 / bcs
  for (let i = 0; i < b.length - 6; i += 2){
    const op = b[i+1];
    if (op < 0x28 || op > 0x2F) continue;
    let form = null;
    if (b[i] === 0x07 && b[i+3] === 0xD8) form = 'le';
    else if (b[i] === 0x08 && b[i+3] === 0xD2) form = 'lt';
    if (!form) continue;
    let eor = 0;
    for (let j = Math.max(0,i-48); j < i; j += 2)
      if (b[j+1] === 0x40 && b[j] >= 0x40 && b[j] <= 0x7F) eor++;
    if (eor >= 2) out.push({ off:i, mode:'thumb', form, old:b[i], reg:op-0x28 });
  }

  // ARM : CMP Rn,#imm  ->  E3 5n 0i ii   (immédiat 8 bits, rotation nulle)
  for (let i = 0; i + 8 <= b.length; i += 4){
    if (b[i+3] !== 0xE3 || (b[i+2] & 0xF0) !== 0x50) continue;
    if (b[i+1] !== 0x00) continue;                    // pas de rotation
    if (b[i] !== 0x07 && b[i] !== 0x08) continue;
    const nb3 = b[i+7];                                // condition du saut suivant
    const form = b[i] === 0x07 ? 'le' : 'lt';
    if ((form === 'le' && (nb3 & 0xF0) !== 0x80) &&    // BHI = cond 1000
        (form === 'lt' && (nb3 & 0xF0) !== 0x20)) continue;  // BCS = cond 0010
    let eor = 0;
    for (let j = Math.max(0,i-64); j < i; j += 4)
      if ((b[j+3] & 0x0F) === 0x00 && (b[j+2] & 0xE0) === 0x20) eor++;
    if (eor >= 1) out.push({ off:i, mode:'arm', form, old:b[i], reg:b[i+2] & 0x0F });
  }
  return out;
}
function shinyPatches(hits, count){
  return hits.map(h => {
    let imm = h.form === 'le' ? count - 1 : count;
    const capped = imm > 255; if (capped) imm = 255;
    return imm !== h.old ? { off:h.off, value:imm, hit:h, capped } : null;
  }).filter(Boolean);
}

/* ---------------------------------------------------------------- *
 *  Garde-fou                                                       *
 *                                                                  *
 *  Le codec n'a pas été confronté à une ROM réelle. Plutôt que de   *
 *  risquer un fichier corrompu, patchNds() ne rend un résultat que  *
 *  si toutes les vérifications passent, et dit laquelle a échoué.   *
 * ---------------------------------------------------------------- */
const GUARD = {
  verified: false,     // à passer à true après validation sur un vrai dump
  reason: "Le codec BLZ n'a pas encore été validé sur une ROM réelle."
};

function patchNds(rom, count, { allowUnverified = false } = {}){
  const report = { ok:false, steps:[], hits:[], rom:null };
  const step = (name, ok, detail) => { report.steps.push({ name, ok, detail }); return ok; };

  const h = readHeader(rom);
  if (!step('en-tête DS lisible', !!h, h ? `${h.title} · ${h.code}` : null)) return report;

  const arm9 = extractArm9(rom);
  if (!step('arm9 extrait', arm9.length === h.arm9Size, `${arm9.length} octets`)) return report;

  const packed = isCompressed(arm9);
  step('arm9 comprimé', packed, packed ? 'pied BLZ détecté' : 'déjà en clair');

  let plain;
  try { plain = packed ? blzDecompress(arm9) : arm9; }
  catch (e){ step('décompression', false, e.message); return report; }
  step('décompression', true, `${plain.length} octets`);

  /* Aller-retour : si recomprimer puis redécomprimer ne redonne pas
     exactement les mêmes octets, le codec est faux — on s'arrête. */
  if (packed){
    let round;
    try { round = blzDecompress(blzCompress(plain)); } catch (e){ round = null; }
    const same = round && round.length === plain.length && round.every((v,i) => v === plain[i]);
    if (!step('aller-retour du codec', !!same)) return report;
  }

  report.hits = findShinyChecks(plain);
  if (!step('test de shininess localisé', report.hits.length > 0,
            `${report.hits.length} candidat(s)`)) return report;

  if (!GUARD.verified && !allowUnverified){
    step('codec validé sur ROM réelle', false, GUARD.reason);
    return report;
  }

  const patches = shinyPatches(report.hits, count);
  const out = plain.slice();
  patches.forEach(p => out[p.off] = p.value);
  const newArm9 = packed ? blzCompress(out) : out;
  report.rom = replaceArm9(rom, newArm9);
  report.ok = step('ROM reconstruite', true, `${report.rom.length} octets`);
  return report;
}

module.exports = {
  readHeader, crc16, fixHeaderCrc, FIELDS,
  blzInfo, isCompressed, blzDecompress, blzCompress,
  extractArm9, replaceArm9,
  findShinyChecks, shinyPatches,
  patchNds, GUARD
};
