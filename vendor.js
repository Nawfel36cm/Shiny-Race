/* =====================================================================
   vendor.js — installation et résolution du randomizer externe.

   DÉCISION : téléchargement au premier usage, pas d'inclusion dans
   l'installeur. L'archive fait une cinquantaine de mégaoctets et
   contient un Java complet ; la livrer avec l'application la
   quadruplerait, et la licence GPL du randomizer impose des obligations
   de redistribution qu'on évite en laissant l'utilisateur le récupérer
   depuis sa source d'origine.

   ⚠ CE QUI A CHANGÉ DEPUIS LA DÉCISION INITIALE
   Le projet ne publie plus un `.jar` seul. Depuis FVX, chaque release
   est une archive par système, contenant le jar, un dossier `data/` et
   un Java embarqué. Conséquence heureuse : plus besoin de chercher un
   Java sur la machine, ni d'en faire installer un. Conséquence
   contraignante : il faut choisir la bonne archive selon le système ET
   l'architecture, et la décompresser soi-même.
   ===================================================================== */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

/* ------------------------------------------------------------------ *
 *  Version épinglée                                                  *
 *                                                                    *
 *  On ne suit pas « la dernière version » automatiquement : une mise  *
 *  à jour du randomizer peut changer le format des réglages, et nos   *
 *  trois modes cesseraient de fonctionner sans prévenir. On épingle,  *
 *  on teste, on relève.                                              *
 * ------------------------------------------------------------------ */
const UPR = {
  tag: 'vFVX1.6.1',
  version: '1.6.1',
  base: 'https://github.com/upr-fvx/universal-pokemon-randomizer-fvx/releases/download',
  page: 'https://github.com/upr-fvx/universal-pokemon-randomizer-fvx/releases',
  jarName: 'UPR-FVX.jar',
  /* Version du format de réglages au moment où nos chaînes ont été
     produites. Le randomizer sait relire une chaîne plus ancienne ;
     il refuse une chaîne abîmée. */
  settingsVersion: 427,
  tailleApprox: 51 * 1024 * 1024
};

/** Archive correspondant à la machine, ou null si non couverte. */
function asset(plateforme = process.platform, arch = process.arch){
  const v = 'UPR_FVX-v' + UPR.version.replace(/\./g, '_');
  const arm = arch === 'arm64';
  if (plateforme === 'win32')  return `${v}-Windows.zip`;
  if (plateforme === 'darwin') return `${v}-Mac_${arm ? 'ARM' : 'x86'}.zip`;
  if (plateforme === 'linux')  return `${v}-Linux_${arm ? 'ARM' : 'x86'}.zip`;
  return null;
}

function url(plateforme, arch){
  const n = asset(plateforme, arch);
  return n ? `${UPR.base}/${UPR.tag}/${n}` : null;
}

/* ------------------------------------------------------------------ *
 *  Emplacement                                                       *
 *                                                                    *
 *  Le randomizer s'installe dans le dossier de données utilisateur,   *
 *  jamais à côté de l'application : sur macOS, et sur une             *
 *  installation Windows pour tous les utilisateurs, le dossier du     *
 *  programme n'est pas accessible en écriture.                        *
 *  Le numéro de version est dans le nom : changer de version pose une *
 *  installation neuve au lieu d'en écraser une à moitié.              *
 * ------------------------------------------------------------------ */
const baseDir    = () => path.join(app.getPath('userData'), 'vendor');
const uprDir     = () => path.join(baseDir(), 'upr-' + UPR.version);
const configPath = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig(){
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); }
  catch { return {}; }
}
function saveConfig(patch){
  const c = { ...loadConfig(), ...patch };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(c, null, 2));
  return c;
}

const exists = p => { try { return !!p && fs.existsSync(p); } catch { return false; } };

/** Java : celui livré avec le randomizer, sinon celui choisi, sinon celui du système. */
function resolveJava(){
  const bin = process.platform === 'win32' ? 'java.exe' : 'java';
  const embarque = path.join(uprDir(), 'java', 'bin', bin);
  if (exists(embarque)) return { path: embarque, source: 'livré avec le randomizer' };
  const choisi = loadConfig().javaPath;
  if (exists(choisi)) return { path: choisi, source: 'choisi' };
  return { path: 'java', source: 'système' };
}

/** Le jar du randomizer. */
function resolveJar(){
  const installe = path.join(uprDir(), UPR.jarName);
  if (exists(installe)) return { path: installe, source: 'installé' };
  const choisi = loadConfig().jarPath;
  if (exists(choisi)) return { path: choisi, source: 'choisi' };
  return { path: null, source: 'absent' };
}

/* ------------------------------------------------------------------ *
 *  Droits d'exécution                                                *
 *                                                                    *
 *  ⚠ L'archive publie TOUT en 0644, y compris son propre Java. Le     *
 *  lanceur officiel fait lui-même un chmod au démarrage, preuve que   *
 *  c'est attendu et non un accident. Sans ça, rien ne s'exécute sur   *
 *  macOS ni Linux, et le message d'erreur remonté n'a aucun rapport   *
 *  avec la cause réelle.                                             *
 * ------------------------------------------------------------------ */
function rendreExecutable(dir){
  if (process.platform === 'win32') return 0;
  let n = 0;
  const marquer = p => { try { fs.chmodSync(p, 0o755); n++; } catch {} };
  const parcourir = (d, profondeur = 0) => {
    if (profondeur > 8) return;
    let entrees = [];
    try { entrees = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entrees){
      const p = path.join(d, e.name);
      if (e.isDirectory()) { parcourir(p, profondeur + 1); continue; }
      const rel = path.relative(dir, p).split(path.sep).join('/');
      if (/\.(sh|command)$/i.test(e.name)) marquer(p);
      else if (/^java\/(bin|lib)\//.test(rel)) marquer(p);
    }
  };
  parcourir(dir);
  return n;
}

/** État de l'installation, tel qu'affiché dans l'onglet. */
function etat(){
  const jar = resolveJar();
  const java = resolveJava();
  return {
    installe: !!jar.path,
    javaEmbarque: java.source === 'livré avec le randomizer',
    version: UPR.version,
    tag: UPR.tag,
    dossier: uprDir(),
    jar, java,
    asset: asset(),
    url: url(),
    page: UPR.page,
    tailleApprox: UPR.tailleApprox,
    supporte: !!asset(),
    presets: listPresets()
  };
}

/** Efface l'installation, pour repartir propre après un téléchargement interrompu. */
function effacer(){
  try { fs.rmSync(uprDir(), { recursive: true, force: true }); return true; }
  catch { return false; }
}

/** Préréglages .rnqs ajoutés par l'utilisateur, en plus de nos trois modes. */
function listPresets(){
  const dirs = [path.join(uprDir(), 'presets'), loadConfig().presetDir].filter(exists);
  const out = [];
  for (const d of dirs){
    let noms = [];
    try { noms = fs.readdirSync(d); } catch { continue; }
    for (const f of noms){
      if (f.toLowerCase().endsWith('.rnqs'))
        out.push({ name: path.basename(f, path.extname(f)), path: path.join(d, f) });
    }
  }
  return out;
}

module.exports = { UPR, asset, url, uprDir, baseDir, resolveJava, resolveJar,
                   rendreExecutable, etat, effacer, listPresets, loadConfig, saveConfig };
