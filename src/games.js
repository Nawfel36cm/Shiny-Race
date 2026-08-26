/* =====================================================================
   games.js — tous les jeux de la 1G à la 7G, avec ce que le logiciel
   sait réellement en faire. Une seule source de vérité : l'écran de
   compatibilité et les messages d'erreur lisent tous ce fichier.

   shiny : 'natif' | 'prevu' | 'impossible'
   rando : 'natif' | 'upr'      ('upr' = délégué au randomizer externe)
   ===================================================================== */

const GENS = [
  {
    gen: 3, platform: 'gba', label: 'Game Boy Advance', rate: '1/8192',
    shiny: 'natif', rando: 'natif',
    why: "Un seul octet à réécrire. Rencontres sauvages randomisées nativement.",
    games: ['Rubis', 'Saphir', 'Émeraude', 'Rouge Feu', 'Vert Feuille']
  },
  {
    gen: 4, platform: 'nds', label: 'Nintendo DS', rate: '1/8192',
    shiny: 'natif', rando: 'upr',
    why: "Fonction de test unique, réécrite sur place. Trois jeux ont un arm9 en clair, deux sont comprimés en BLZ ; le logiciel détecte le cas au lieu de le supposer.",
    games: ['Diamant', 'Perle', 'Platine', 'Or HeartGold', 'Argent SoulSilver']
  },
  {
    gen: 5, platform: 'nds', label: 'Nintendo DS', rate: '1/8192',
    shiny: 'natif', rando: 'upr',
    why: "Même fonction qu'en 4G, à un octet près. Pas de boucle anti-chromatique, contrairement à la 4G.",
    games: ['Noir', 'Blanc', 'Noir 2', 'Blanc 2']
  },
  {
    gen: 6, platform: 'n3ds', label: 'Nintendo 3DS', rate: '1/4096',
    shiny: 'prevu', rando: 'upr',
    why: "Dump déchiffré obligatoire, et la sortie est un dossier LayeredFS, pas une ROM.",
    games: ['X', 'Y', 'Rubis Oméga', 'Saphir Alpha']
  },
  {
    gen: 7, platform: 'n3ds', label: 'Nintendo 3DS', rate: '1/4096',
    shiny: 'prevu', rando: 'upr',
    why: "Chaîne identique à la 6G. Beaucoup de rencontres sont déjà verrouillées non-shiny par le jeu.",
    games: ['Soleil', 'Lune', 'Ultra-Soleil', 'Ultra-Lune']
  }
];

/* ---------------------------------------------------------------- *
 *  Identification des jeux DS par leur code de cartouche            *
 *                                                                   *
 *  Les trois premières lettres désignent le jeu, la quatrième la    *
 *  région. On n'affiche jamais un nom deviné : un code inconnu est  *
 *  annoncé comme tel, pour que tu voies tout de suite si le fichier *
 *  ouvert n'est pas celui que tu croyais.                           *
 * ---------------------------------------------------------------- */
const NDS_TITRES = {
  ADA: { nom: 'Pokémon Diamant',            gen: 4 },
  APA: { nom: 'Pokémon Perle',              gen: 4 },
  CPU: { nom: 'Pokémon Platine',            gen: 4 },
  IPK: { nom: 'Pokémon Or HeartGold',       gen: 4 },
  IPG: { nom: 'Pokémon Argent SoulSilver',  gen: 4 },
  IRB: { nom: 'Pokémon Version Noire',      gen: 5 },
  IRA: { nom: 'Pokémon Version Blanche',    gen: 5 },
  IRE: { nom: 'Pokémon Version Noire 2',    gen: 5 },
  IRD: { nom: 'Pokémon Version Blanche 2',  gen: 5 }
};
const NDS_REGIONS = {
  F: 'France', E: 'Amérique du Nord', O: 'Europe', P: 'Europe',
  D: 'Allemagne', I: 'Italie', S: 'Espagne', J: 'Japon', K: 'Corée'
};

/** Code de cartouche (ex. « CPUF ») → jeu reconnu, ou null. */
function ndsGame(code){
  const c = String(code || '').toUpperCase().trim();
  if (c.length < 3) return null;
  const t = NDS_TITRES[c.slice(0, 3)];
  if (!t) return null;
  const r = NDS_REGIONS[c[3]] || null;
  return { nom: t.nom, gen: t.gen, region: r, code: c, connu: true };
}

const BADGES = {
  natif:      { text: 'natif',     cls: 'ok',   tip: "Écrit dans ce logiciel, sans moteur externe." },
  upr:        { text: 'intégré',   cls: 'ok',   tip: "Moteur livré avec l'application, onglet Randomizer complet." },
  prevu:      { text: 'à venir',   cls: 'dim',  tip: "Pas encore implémenté." },
  impossible: { text: 'impossible',cls: 'ko',   tip: "Absent du jeu d'origine, aucun patch ne peut le créer." }
};

/** Les générations correspondant à un support détecté. */
function gensFor(platformId) {
  return GENS.filter(g => g.platform === platformId);
}

window.GAMES = { GENS, BADGES, gensFor, NDS_TITRES, NDS_REGIONS, ndsGame };
