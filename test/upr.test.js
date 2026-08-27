/* =====================================================================
   upr.test.js — lecteur ZIP, choix de l'archive, chaînes de réglages.

   `node test/upr.test.js`
   ===================================================================== */

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const U = require('../unzip');
const { UPR_MODES, uprMode, uprSeed, uprSeedAuHasard } = require('../src/upr-modes');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond){ pass++; console.log('  ✓', name, extra); }
  else { fail++; console.log('  ✗', name, extra); }
};

/* ------------------------------------------------------------------ *
 *  Fabrique une archive ZIP minimale, sans dépendance externe.        *
 *  Deux entrées : une comprimée, une stockée telle quelle, plus un    *
 *  mode Unix, pour couvrir les trois chemins du lecteur.              *
 * ------------------------------------------------------------------ */
function faireZip(entrees){
  const locaux = [], centraux = [];
  let off = 0;
  for (const e of entrees){
    const nom = Buffer.from(e.nom, 'utf8');
    const brut = Buffer.from(e.data);
    const comp = e.methode === 8 ? zlib.deflateRawSync(brut) : brut;

    const loc = Buffer.alloc(30);
    loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(20, 4);
    loc.writeUInt16LE(e.methode, 8);
    loc.writeUInt32LE(0, 14);                       // crc, non vérifié par le lecteur
    loc.writeUInt32LE(comp.length, 18);
    loc.writeUInt32LE(brut.length, 22);
    loc.writeUInt16LE(nom.length, 26);
    locaux.push(Buffer.concat([loc, nom, comp]));

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(20, 4); cen.writeUInt16LE(20, 6);
    cen.writeUInt16LE(e.methode, 10);
    cen.writeUInt32LE(comp.length, 20);
    cen.writeUInt32LE(brut.length, 24);
    cen.writeUInt16LE(nom.length, 28);
    cen.writeUInt32LE(((e.mode || 0) & 0xFFF) << 16, 38);
    cen.writeUInt32LE(off, 42);
    centraux.push(Buffer.concat([cen, nom]));
    off += 30 + nom.length + comp.length;
  }
  const corps = Buffer.concat(locaux);
  const cd = Buffer.concat(centraux);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entrees.length, 8);
  eocd.writeUInt16LE(entrees.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(corps.length, 16);
  return Buffer.concat([corps, cd, eocd]);
}

console.log('\nLecteur ZIP');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'srs-zip-'));
  const grand = Buffer.from('ABCABCABC'.repeat(4000));
  const zip = faireZip([
    { nom: 'lisez-moi.txt', data: Buffer.from('bonjour'), methode: 0, mode: 0o644 },
    { nom: 'java/bin/java', data: grand,                  methode: 8, mode: 0o644 },
    { nom: 'dossier/vide.bin', data: Buffer.alloc(0),     methode: 0, mode: 0o644 }
  ]);
  const zpath = path.join(tmp, 'a.zip');
  fs.writeFileSync(zpath, zip);

  const entrees = U.lireEntrees(zip);
  ok('les trois entrées sont listées', entrees.length === 3);
  ok('la méthode de compression est lue',
     entrees[0].methode === 0 && entrees[1].methode === 8);

  const dest = path.join(tmp, 'sortie');
  const n = U.extraire(zpath, dest);
  ok('trois fichiers écrits', n === 3);
  ok('contenu stocké intact',
     fs.readFileSync(path.join(dest, 'lisez-moi.txt'), 'utf8') === 'bonjour');
  ok('contenu comprimé intact',
     fs.readFileSync(path.join(dest, 'java/bin/java')).equals(grand),
     `${grand.length} octets`);
  ok('les sous-dossiers sont créés', fs.existsSync(path.join(dest, 'dossier/vide.bin')));

  /* Un chemin qui remonte hors de la destination est le piège classique
     des archives : le lecteur doit refuser, pas écrire. */
  const mechant = faireZip([{ nom: '../evade.txt', data: Buffer.from('non'), methode: 0 }]);
  const mpath = path.join(tmp, 'm.zip');
  fs.writeFileSync(mpath, mechant);
  let refuse = false;
  try { U.extraire(mpath, path.join(tmp, 'sortie2')); } catch { refuse = true; }
  ok('un chemin remontant hors du dossier est refusé', refuse);
  ok('et rien n\'a été écrit à côté', !fs.existsSync(path.join(tmp, 'evade.txt')));

  /* Une archive tronquée doit produire un message, pas un fichier à moitié. */
  let dit = false;
  try { U.lireEntrees(Buffer.from('pas une archive du tout')); } catch (e){ dit = /introuvable/.test(e.message); }
  ok('une archive illisible est annoncée comme telle', dit);

  fs.rmSync(tmp, { recursive: true, force: true });
}

/* ------------------------------------------------------------------ *
 *  Choix de l'archive selon la machine                                *
 *                                                                    *
 *  vendor.js dépend d'Electron ; on ne peut pas le charger sous Node  *
 *  seul. On recopie donc la seule règle qui compte et on vérifie      *
 *  qu'elle correspond aux noms réellement publiés par le projet.      *
 * ------------------------------------------------------------------ */
console.log('\nChoix de l\'archive du randomizer');
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'vendor.js'), 'utf8');
  const version = (src.match(/version:\s*'([^']+)'/) || [])[1];
  const tag     = (src.match(/tag:\s*'([^']+)'/) || [])[1];
  ok('version et étiquette épinglées', !!version && !!tag, `${tag} · ${version}`);
  ok('l\'étiquette contient la version', !!tag && tag.includes(version));

  /* Les cinq noms publiés pour la version épinglée. */
  const v = 'UPR_FVX-v' + String(version).replace(/\./g, '_');
  const attendus = [`${v}-Windows.zip`, `${v}-Mac_ARM.zip`, `${v}-Mac_x86.zip`,
                    `${v}-Linux_ARM.zip`, `${v}-Linux_x86.zip`];
  const regle = (p, a) => {
    const arm = a === 'arm64';
    if (p === 'win32')  return `${v}-Windows.zip`;
    if (p === 'darwin') return `${v}-Mac_${arm ? 'ARM' : 'x86'}.zip`;
    if (p === 'linux')  return `${v}-Linux_${arm ? 'ARM' : 'x86'}.zip`;
    return null;
  };
  const cas = [['win32','x64'],['win32','arm64'],['darwin','arm64'],['darwin','x64'],
               ['linux','x64'],['linux','arm64']];
  ok('chaque système reçoit une archive publiée',
     cas.every(([p,a]) => attendus.includes(regle(p,a))));
  ok('macOS Apple Silicon reçoit bien l\'archive ARM',
     regle('darwin','arm64').endsWith('Mac_ARM.zip'));
  ok('un système inconnu ne reçoit rien plutôt qu\'au hasard', regle('sunos','x64') === null);
}

/* ------------------------------------------------------------------ *
 *  Chaînes de réglages                                               *
 *                                                                    *
 *  Elles portent une somme de contrôle : un caractère changé et le    *
 *  randomizer les refuse. On vérifie donc surtout qu'elles n'ont pas  *
 *  été retouchées par mégarde, et qu'elles restent distinctes.        *
 * ------------------------------------------------------------------ */
console.log('\nModes de randomisation');
{
  ok('trois modes proposés', UPR_MODES.length === 3);
  ok('identifiants attendus',
     UPR_MODES.map(m => m.id).join(',') === 'global,zone,slot');
  ok('chaque mode a une chaîne de réglages',
     UPR_MODES.every(m => typeof m.settings === 'string' && m.settings.length > 60));
  ok('les trois chaînes sont différentes',
     new Set(UPR_MODES.map(m => m.settings)).size === 3);

  /* Le préfixe est la version du format, commune aux trois. */
  const versions = new Set(UPR_MODES.map(m => m.settings.slice(0, 3)));
  ok('même version de format partout', versions.size === 1, [...versions][0]);

  const src = fs.readFileSync(path.join(__dirname, '..', 'vendor.js'), 'utf8');
  const attendue = (src.match(/settingsVersion:\s*(\d+)/) || [])[1];
  ok('la version annoncée dans vendor.js correspond aux chaînes',
     attendue === [...versions][0], `vendor ${attendue}`);

  /* Base64 valide, longueur identique : les trois viennent bien du même
     format et n'ont pas été tronquées. */
  ok('les chaînes sont du base64 lisible',
     UPR_MODES.every(m => /^[0-9]{3}[A-Za-z0-9+/]+=*$/.test(m.settings)));
  ok('même longueur pour les trois',
     new Set(UPR_MODES.map(m => m.settings.length)).size === 1,
     UPR_MODES[0].settings.length + ' caractères');

  ok('un identifiant inconnu retombe sur le premier mode',
     uprMode('nexistepas').id === 'global');
  ok('chaque mode est expliqué en français',
     UPR_MODES.every(m => m.aide && m.aide.length > 40 && m.label));
}

/* ------------------------------------------------------------------ *
 *  La graine                                                          *
 *                                                                     *
 *  `-z` est lu par Long.parseLong côté randomizer. Tout ce qui n'est  *
 *  pas un entier fait échouer l'appel avec « Invalid seed - could     *
 *  not parse as long » — le bug qui rendait le bouton inutilisable    *
 *  quelle que soit la ROM.                                            *
 * ------------------------------------------------------------------ */
{
  console.log('\nGraine du randomizer');

  const entier = v => /^-?\d{1,19}$/.test(v);

  ok('une graine texte devient un entier',   entier(uprSeed('course-du-samedi')), uprSeed('course-du-samedi'));
  ok('une graine accentuée aussi',           entier(uprSeed('épreuve n°1')),      uprSeed('épreuve n°1'));
  ok('une graine vide aussi',                entier(uprSeed('')));
  ok('une graine absente aussi',             entier(uprSeed(undefined)) && entier(uprSeed(null)));
  ok('une graine base36 aussi',              entier(uprSeed('k3f9x2ab')), '← la forme exacte qui plantait');

  /* Deux joueurs qui saisissent la même graine doivent obtenir la même
     ROM : c'est la promesse faite à l'écran. Aucun aléa, aucune
     horloge dans la conversion. */
  ok('la conversion est déterministe',
     uprSeed('race') === uprSeed('race') && uprSeed('race') === uprSeed(' race '));
  ok('deux graines différentes donnent deux nombres différents',
     uprSeed('race-01') !== uprSeed('race-02'));

  /* Une graine déjà numérique n'est pas touchée : elle reste
     interchangeable avec l'interface graphique du randomizer. */
  ok('un nombre passe tel quel',       uprSeed('123456') === '123456');
  ok('un nombre négatif passe aussi',  uprSeed('-42') === '-42');
  ok('un nombre trop long est haché',
     uprSeed('12345678901234567890') !== '12345678901234567890'
     && entier(uprSeed('12345678901234567890')));

  /* Le tirage au sort doit produire directement une graine valide :
     c'est la valeur que le bouton écrit dans le champ. */
  let tousEntiers = true, distincts = new Set();
  for (let i = 0; i < 200; i++){
    const g = uprSeedAuHasard();
    if (!entier(g)) tousEntiers = false;
    distincts.add(g);
  }
  ok('le tirage au sort produit un entier', tousEntiers);
  ok('le tirage au sort ne se répète pas', distincts.size > 190, distincts.size + '/200');
  ok('une graine tirée au sort passe la conversion inchangée',
     (g => uprSeed(g) === g)(uprSeedAuHasard()));
}

console.log(`\n${pass} réussis, ${fail} échoués\n`);
process.exit(fail ? 1 : 0);
