/* =====================================================================
   vendor.js — résolution de tout ce que le logiciel embarque.

   Objectif : l'utilisateur ne voit qu'une application. Pas de Java à
   installer, pas de .jar à télécharger, pas de dossier à choisir.

   Ordre de recherche, du plus intégré au plus dégradé :
     1. dossier vendor/ livré dans l'installeur
     2. réglages enregistrés par l'utilisateur
     3. Java du système
   Le mode dégradé existe pour le développement et pour les
   distributions où l'on ne peut pas redistribuer le .jar.
   ===================================================================== */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const packaged = () => app.isPackaged;
const vendorDir = () => packaged()
  ? path.join(process.resourcesPath, 'vendor')
  : path.join(__dirname, 'vendor');

const configPath = () => path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(configPath(), 'utf8')); }
  catch { return {}; }
}
function saveConfig(patch) {
  const c = { ...loadConfig(), ...patch };
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(c, null, 2));
  return c;
}

const exists = p => { try { return !!p && fs.existsSync(p); } catch { return false; } };

/** Java : runtime embarqué en priorité, sinon celui de la machine. */
function resolveJava() {
  const bin = process.platform === 'win32' ? 'java.exe' : 'java';
  const bundled = path.join(vendorDir(), 'jre', 'bin', bin);
  if (exists(bundled)) return { path: bundled, source: 'embarqué' };
  const custom = loadConfig().javaPath;
  if (exists(custom)) return { path: custom, source: 'choisi' };
  return { path: 'java', source: 'système' };
}

/** Randomizer : .jar embarqué en priorité. */
function resolveJar() {
  const bundled = path.join(vendorDir(), 'PokeRandoZX.jar');
  if (exists(bundled)) return { path: bundled, source: 'embarqué' };
  const custom = loadConfig().jarPath;
  if (exists(custom)) return { path: custom, source: 'choisi' };
  return { path: null, source: 'absent' };
}

/** Préréglages .rnqs livrés avec l'application, plus ceux ajoutés par l'utilisateur. */
function listPresets() {
  const dirs = [path.join(vendorDir(), 'presets'), loadConfig().presetDir].filter(exists);
  const out = [];
  for (const d of dirs) {
    for (const f of fs.readdirSync(d)) {
      if (f.toLowerCase().endsWith('.rnqs')) {
        out.push({ name: path.basename(f, path.extname(f)), path: path.join(d, f) });
      }
    }
  }
  return out;
}

module.exports = { resolveJava, resolveJar, listPresets, loadConfig, saveConfig, vendorDir };
