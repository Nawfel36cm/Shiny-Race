/* =====================================================================
   platforms.js — reconnaissance du support et registre des pilotes.

   Un « pilote » sait faire trois choses pour une famille de consoles :
     identify(bytes)   → décrire le jeu
     shiny(bytes)      → localiser et réécrire le test de shininess
     wild(bytes)       → localiser et réécrire les rencontres sauvages

   Le pilote GBA est complet. Les autres déclarent honnêtement leur état
   plutôt que de produire une ROM corrompue : mieux vaut un message clair
   qu'un patch qui casse une sauvegarde en pleine race.
   ===================================================================== */

const STATUS = { OK: 'ok', PARTIAL: 'partiel', PLANNED: 'prévu', IMPOSSIBLE: 'impossible' };

/* ---------------------------------------------------------------- *
 *  Détection du support                                            *
 *  Uniquement sur des marqueurs d'en-tête vérifiables, jamais sur  *
 *  l'extension du fichier.                                         *
 * ---------------------------------------------------------------- */
function detectPlatform(b) {
  const ascii = (o, n) => String.fromCharCode(...b.slice(o, o + n)).replace(/\0/g, '').trim();
  const magic = o => ascii(o, 4);

  // Game Boy / Game Boy Color : logo Nintendo en 0x104, en-tête en 0x134
  if (b.length > 0x150 && b[0x104] === 0xCE && b[0x105] === 0xED && b[0x106] === 0x66) {
    return { id: 'gb', label: b[0x143] & 0x80 ? 'Game Boy Color' : 'Game Boy',
             title: ascii(0x134, 11), code: ascii(0x13F, 4) };
  }
  // Game Boy Advance : valeur fixe 0x96 en 0xB2
  if (b.length > 0x1000 && b[0xB2] === 0x96) {
    return { id: 'gba', label: 'Game Boy Advance',
             title: ascii(0xA0, 12), code: ascii(0xAC, 4), version: b[0xBC] };
  }
  // Nintendo DS : CRC du logo en 0x15C vaut toujours 0xCF56
  if (b.length > 0x200 && b[0x15C] === 0x56 && b[0x15D] === 0xCF) {
    return { id: 'nds', label: 'Nintendo DS',
             title: ascii(0x00, 12), code: ascii(0x0C, 4), version: b[0x1E] };
  }
  // Nintendo 3DS : NCSD (.3ds / .cci) ou NCCH (.cxi) en 0x100
  if (b.length > 0x200 && (magic(0x100) === 'NCSD' || magic(0x100) === 'NCCH')) {
    return { id: 'n3ds', label: 'Nintendo 3DS', container: magic(0x100),
             title: '', code: ascii(0x150, 4) };
  }
  return null;
}

/* ---------------------------------------------------------------- *
 *  Ce que chaque famille demande réellement comme travail          *
 * ---------------------------------------------------------------- */
const DRIVERS = {
  gb:   { label: 'Game Boy / Color — 1G et 2G',   shiny: { status: STATUS.PARTIAL }, wild: { status: STATUS.PLANNED } },
  gba:  { label: 'Game Boy Advance — 3G',         shiny: { status: STATUS.OK },      wild: { status: STATUS.OK } },
  nds:  { label: 'Nintendo DS — 4G et 5G',        shiny: { status: STATUS.PLANNED }, wild: { status: STATUS.PLANNED } },
  n3ds: { label: 'Nintendo 3DS — 6G et 7G',       shiny: { status: STATUS.PLANNED }, wild: { status: STATUS.PLANNED } }
};

/** Résumé affichable pour un fichier chargé. */
function describe(b) {
  const p = detectPlatform(b);
  if (!p) return null;
  const d = DRIVERS[p.id];
  return { platform: p, driver: d, shiny: d.shiny, wild: d.wild, usable: d.shiny.status === STATUS.OK };
}

window.PLATFORMS = { STATUS, detectPlatform, describe, DRIVERS };
