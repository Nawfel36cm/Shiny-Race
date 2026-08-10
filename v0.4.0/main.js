const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const vendor = require('./vendor');
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
  if (app.isPackaged && !isPortable()) {
    autoUpdater.checkForUpdates().catch(() => {});
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
    filters: [{ name: 'ROM Game Boy Advance', extensions: ['gba', 'bin'] }],
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
 *  Pont vers l'Universal Pokémon Randomizer ZX (facultatif)           *
 *  Processus séparé, invoqué en ligne de commande. On ne lie aucun    *
 *  code : le jar reste un exécutable tiers que l'utilisateur fournit. *
 * ------------------------------------------------------------------ */

function run(cmd, args) {
  return new Promise(resolve => {
    let out = '', err = '';
    const p = spawn(cmd, args, { windowsHide: true });
    p.stdout.on('data', d => { out += d; win.webContents.send('upr-log', String(d)); });
    p.stderr.on('data', d => { err += d; win.webContents.send('upr-log', String(d)); });
    p.on('error', e => resolve({ ok: false, out, err: e.message }));
    p.on('close', code => resolve({ ok: code === 0, code, out, err }));
  });
}

/** État complet de l'installation, calculé au démarrage. */
ipcMain.handle('setup-state', async () => {
  const java = vendor.resolveJava();
  const jar = vendor.resolveJar();
  const probe = await run(java.path, ['-version']);
  return {
    java: { ...java, ok: probe.ok, version: (probe.err || probe.out).split('\n')[0] || '' },
    jar,
    presets: vendor.listPresets(),
    ready: probe.ok && !!jar.path
  };
});

ipcMain.handle('set-path', async (_e, { key, value }) => vendor.saveConfig({ [key]: value }));

ipcMain.handle('run-upr', async (_e, { input, output, settings, log }) => {
  const java = vendor.resolveJava();
  const jar = vendor.resolveJar();
  if (!jar.path) return { ok: false, err: 'Randomizer introuvable.' };
  const args = ['-Xmx4608M', '-jar', jar.path, 'cli', '-i', input, '-o', output, '-s', settings];
  if (log) args.push('-l');
  return run(java.path, args);
});
