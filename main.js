const { app, BrowserWindow, ipcMain, dialog, shell, net } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const vendor = require('./vendor');
const unzip = require('./unzip');
const { autoUpdater } = require('electron-updater');

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 940,
    height: 860,
    minWidth: 720,
    minHeight: 600,
    backgroundColor: '#15111F',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

/* ------------------------------------------------------------------ *
 *  Mises à jour                                                       *
 *                                                                     *
 *  Deux chemins : une vérification silencieuse au démarrage, et un    *
 *  bouton dans l'interface. Les deux passent par les mêmes événements *
 *  d'electron-updater, réémis vers la fenêtre pour l'affichage.       *
 * ------------------------------------------------------------------ */
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

const toWindow = msg => { if (win && !win.isDestroyed()) win.webContents.send('update', msg); };

autoUpdater.on('checking-for-update', () => toWindow({ state: 'checking' }));
autoUpdater.on('update-not-available', i => toWindow({ state: 'none', version: (i && i.version) || app.getVersion() }));
autoUpdater.on('update-available',     i => toWindow({ state: 'found', version: i && i.version }));
autoUpdater.on('download-progress',    p => toWindow({ state: 'progress', percent: p.percent }));
autoUpdater.on('update-downloaded',    i => toWindow({ state: 'ready', version: i && i.version }));
autoUpdater.on('error',                e => toWindow({ state: 'error', message: String(e && e.message || e) }));

/* La version portable est décompressée par l'utilisateur : elle n'a ni
   installeur ni droits d'écriture garantis, donc pas de mise à jour en
   place. On le dit plutôt que d'échouer silencieusement. */
const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_DIR
  || (process.platform === 'win32' && !/\\AppData\\Local\\Programs\\/i.test(process.execPath)
      && !/\\Program Files/i.test(process.execPath));

ipcMain.handle('update-check', async () => {
  if (!app.isPackaged) return toWindow({ state: 'none', version: app.getVersion() + ' (développement)' });
  if (isPortable())    return toWindow({ state: 'portable' });
  try { await autoUpdater.checkForUpdates(); }
  catch (e) { toWindow({ state: 'error', message: String(e && e.message || e) }); }
});

ipcMain.handle('update-install', async () => { autoUpdater.quitAndInstall(); });

ipcMain.handle('app-version', async () => app.getVersion());

app.whenReady().then(() => {
  createWindow();
  /* La verification attend que la page ait fini de charger : lancee plus
     tot, ses evenements partiraient avant que l'interface n'ecoute, et
     la nouvelle version passerait inapercue. */
  if (app.isPackaged && !isPortable() && win) {
    win.webContents.once('did-finish-load', () => {
      setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 1200);
    });
  }
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

/* ------------------------------------------------------------------ *
 *  Fichiers                                                          *
 * ------------------------------------------------------------------ */

ipcMain.handle('pick-rom', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choisir une ROM',
    filters: [
      { name: 'ROM Game Boy Advance ou Nintendo DS', extensions: ['gba', 'nds', 'bin'] },
      { name: 'Tous les fichiers', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (r.canceled) return null;
  const p = r.filePaths[0];
  const buf = await fs.readFile(p);
  return { path: p, name: path.basename(p), bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
});

ipcMain.handle('read-rom', async (_e, p) => {
  const buf = await fs.readFile(p);
  return { path: p, name: path.basename(p), bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
});

ipcMain.handle('pick-file', async (_e, { title, filters }) => {
  const r = await dialog.showOpenDialog(win, { title, filters, properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('save-bytes', async (_e, { data, defaultName, filters }) => {
  const r = await dialog.showSaveDialog(win, { title: 'Enregistrer', defaultPath: defaultName, filters });
  if (r.canceled) return null;
  await fs.writeFile(r.filePath, Buffer.from(data));
  return r.filePath;
});

ipcMain.handle('reveal', async (_e, p) => { shell.showItemInFolder(p); });

/* ------------------------------------------------------------------ *
 *  Randomizer Universal Pokémon FVX                                  *
 *                                                                    *
 *  Processus séparé, invoqué en ligne de commande. On ne lie aucun    *
 *  code : le jar reste un exécutable tiers, téléchargé depuis sa      *
 *  source d'origine et jamais redistribué par nous.                   *
 * ------------------------------------------------------------------ */

function run(cmd, args, opts = {}) {
  return new Promise(resolve => {
    let out = '', err = '';
    const p = spawn(cmd, args, { windowsHide: true, ...opts });
    p.stdout.on('data', d => { out += d; toWindow2('upr-log', String(d)); });
    p.stderr.on('data', d => { err += d; toWindow2('upr-log', String(d)); });
    p.on('error', e => resolve({ ok: false, out, err: e.message }));
    p.on('close', code => resolve({ ok: code === 0, code, out, err }));
  });
}
const toWindow2 = (canal, msg) => { if (win && !win.isDestroyed()) win.webContents.send(canal, msg); };

ipcMain.handle('upr-state', async () => vendor.etat());

/* ------------------------------------------------------------------ *
 *  Installation                                                      *
 *                                                                    *
 *  Trois temps, chacun signalé à l'interface : téléchargement,        *
 *  décompression, pose des droits. Une cinquantaine de mégaoctets     *
 *  puis six cents fichiers — sans progression, l'utilisateur conclut  *
 *  au plantage, exactement comme pour la recompression de l'arm9.     *
 * ------------------------------------------------------------------ */
ipcMain.handle('upr-install', async () => {
  const dest = vendor.uprDir();
  const lien = vendor.url();
  if (!lien) return { ok: false, err: "Aucune archive du randomizer ne correspond à ce système." };

  const dire = m => toWindow2('upr-progress', m);
  const tmp = path.join(app.getPath('temp'), 'upr-' + Date.now() + '.zip');

  try {
    dire({ etape: 'telechargement', pourcent: 0 });
    await telecharger(lien, tmp, (recu, total) => {
      dire({ etape: 'telechargement', pourcent: total ? (recu / total) * 100 : 0, recu, total });
    });

    /* Une installation à moitié faite est pire qu'aucune : on repart
       toujours d'un dossier vide. */
    dire({ etape: 'extraction', pourcent: 0 });
    vendor.effacer();
    await fs.mkdir(dest, { recursive: true });
    const n = unzip.extraire(tmp, dest, (fait, total) => {
      if (fait % 25 === 0 || fait === total)
        dire({ etape: 'extraction', pourcent: (fait / total) * 100, fait, total });
    });

    dire({ etape: 'droits', pourcent: 100 });
    const marques = vendor.rendreExecutable(dest);

    /* On ne déclare pas l'installation réussie parce que la
       décompression n'a pas levé d'erreur : on vérifie que le jar est
       là et que le Java livré répond. */
    const java = vendor.resolveJava(), jar = vendor.resolveJar();
    if (!jar.path) throw new Error("le jar est absent après extraction");
    const essai = await run(java.path, ['-version']);
    if (!essai.ok) throw new Error("le Java livré avec le randomizer ne démarre pas : "
                                 + (essai.err || essai.out || '').split('\n')[0]);

    dire({ etape: 'fini', pourcent: 100 });
    return { ok: true, fichiers: n, marques, etat: vendor.etat(),
             java: (essai.err || essai.out || '').split('\n')[0] };
  } catch (e) {
    vendor.effacer();
    return { ok: false, err: String((e && e.message) || e) };
  } finally {
    try { await fs.unlink(tmp); } catch {}
  }
});

/** Téléchargement par le module réseau d'Electron : il suit les
    redirections de GitHub et respecte le proxy du système. */
function telecharger(lien, dest, onProgress){
  return new Promise((resolve, reject) => {
    const req = net.request({ url: lien, redirect: 'follow' });
    req.on('response', res => {
      if (res.statusCode !== 200)
        return reject(new Error(`le serveur a répondu ${res.statusCode}`));
      const total = parseInt(res.headers['content-length'] || 0, 10);
      const morceaux = [];
      let recu = 0;
      res.on('data', c => {
        morceaux.push(c); recu += c.length;
        if (onProgress) onProgress(recu, total);
      });
      res.on('end', async () => {
        try { await fs.writeFile(dest, Buffer.concat(morceaux)); resolve(recu); }
        catch (e){ reject(e); }
      });
      res.on('error', reject);
    });
    req.on('error', e => reject(new Error("téléchargement impossible : " + e.message)));
    req.end();
  });
}

ipcMain.handle('upr-remove', async () => ({ ok: vendor.effacer(), etat: vendor.etat() }));

ipcMain.handle('set-path', async (_e, { key, value }) => vendor.saveConfig({ [key]: value }));

/* ------------------------------------------------------------------ *
 *  Exécution                                                         *
 *                                                                    *
 *  Le dossier de travail est celui du randomizer : son dossier        *
 *  `data/` est cherché relativement, et il ne trouverait rien depuis  *
 *  ailleurs.                                                          *
 * ------------------------------------------------------------------ */
ipcMain.handle('upr-run', async (_e, { input, settings, seed, log }) => {
  const java = vendor.resolveJava();
  const jar = vendor.resolveJar();
  if (!jar.path) return { ok: false, err: "Randomizer non installé." };

  const sortie = path.join(app.getPath('temp'),
    'shinyrace-upr-' + Date.now() + path.extname(input || '.gba'));

  const args = ['-Xmx4608M', '-jar', jar.path, 'cli', '-i', input, '-o', sortie, '-S', settings];
  if (seed) args.push('-z', String(seed));
  if (log) args.push('-l');

  const r = await run(java.path, args, { cwd: path.dirname(jar.path) });
  if (!r.ok) return { ok: false, err: (r.err || r.out || '').trim().split('\n').slice(0, 4).join(' · ') };

  try {
    const buf = await fs.readFile(sortie);
    await fs.unlink(sortie).catch(() => {});
    return { ok: true, name: path.basename(sortie),
             bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  } catch (e) {
    return { ok: false, err: "le randomizer n'a pas produit de fichier lisible : " + e.message };
  }
});
