/* =====================================================================
   games.js — tous les jeux de la 1G à la 7G, avec ce que le logiciel
   sait réellement en faire. Une seule source de vérité : l'écran de
   compatibilité et les messages d'erreur lisent tous ce fichier.

   shiny : 'natif' | 'prevu' | 'impossible'
   rando : 'natif' | 'upr'      ('upr' = délégué au randomizer externe)
   ===================================================================== */

const GENS = [
  {
    gen: 1, platform: 'gb', label: 'Game Boy', rate: null,
    shiny: 'impossible', rando: 'upr',
    why: "Les Pokémon chromatiques n'existent pas encore : ils apparaissent en 2G.",
    games: ['Rouge', 'Bleu', 'Jaune']
  },
  {
    gen: 2, platform: 'gb', label: 'Game Boy Color', rate: '1/8192',
    shiny: 'prevu', rando: 'upr',
    why: "La shininess est déduite des DV, pas d'une constante : augmenter le taux force aussi certaines statistiques.",
    games: ['Or', 'Argent', 'Cristal']
  },
  {
    gen: 3, platform: 'gba', label: 'Game Boy Advance', rate: '1/8192',
    shiny: 'natif', rando: 'natif',
    why: "Un seul octet à réécrire. Rencontres sauvages randomisées nativement.",
    games: ['Rubis', 'Saphir', 'Émeraude', 'Rouge Feu', 'Vert Feuille']
  },
  {
    gen: 4, platform: 'nds', label: 'Nintendo DS', rate: '1/8192',
    shiny: 'prevu', rando: 'upr',
    why: "Même formule qu'en 3G, mais le code est dans arm9.bin, compressé. Il faut décompresser, patcher, reconstruire.",
    games: ['Diamant', 'Perle', 'Platine', 'Or HeartGold', 'Argent SoulSilver']
  },
  {
    gen: 5, platform: 'nds', label: 'Nintendo DS', rate: '1/8192',
    shiny: 'prevu', rando: 'upr',
    why: "Chaîne identique à la 4G.",
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

window.GAMES = { GENS, BADGES, gensFor };
