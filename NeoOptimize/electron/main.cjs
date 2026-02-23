const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const isDev = process.env.NODE_ENV === 'development' || process.env.VITE_DEV_SERVER_URL;

// auto-updater
let autoUpdater;
try {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false;
} catch (e) {
  console.warn('electron-updater not available in this environment');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    const url = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';
    win.loadURL(url);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  return win;
}

app.whenReady().then(() => {
  // On Windows, set AppUserModelId for notifications
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.neooptimize.app');
  }

  const win = createWindow();

  // auto-update: check on start (stubbed)
  if (autoUpdater) {
    autoUpdater.checkForUpdates();
    autoUpdater.on('update-available', () => {
      win.webContents.send('update:available');
    });
    autoUpdater.on('update-downloaded', () => {
      win.webContents.send('update:downloaded');
    });
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// Engine IPC (use python CLI wrappers when available, fallback to JS engine)
const engine = require(path.join(__dirname, 'engine.cjs'));
const { spawnSync } = require('child_process');
const fs = require('fs');

function _loadConfigFile() {
  const cfgPath = path.join(__dirname, '..', 'config.txt');
  try {
    if (!fs.existsSync(cfgPath)) return {};
    const txt = fs.readFileSync(cfgPath, 'utf8');
    const lines = txt.split(/\r?\n/).map((l) => l.trim());
    const cfg = {};
    for (const l of lines) {
      if (!l || l.startsWith('#')) continue;
      const idx = l.indexOf('=');
      if (idx === -1) continue;
      const k = l.substring(0, idx).trim();
      const v = l.substring(idx + 1).trim();
      cfg[k] = v;
    }
    return cfg;
  } catch (e) {
    return {};
  }
}

function runPythonScript(relPath, args = []) {
  const py = process.env.PYTHON || process.env.PYTHON3 || 'python';
  const scriptPath = path.join(__dirname, '..', relPath);
  if (!fs.existsSync(scriptPath)) return { error: 'script-not-found', path: scriptPath };
  try {
    const cfg = _loadConfigFile();
    const env = Object.assign({}, process.env, { NEO_CONFIG: JSON.stringify(cfg) });
    const res = spawnSync(py, [scriptPath, ...args], { encoding: 'utf8', timeout: 1000 * 60 * 10, env });
    if (res.error) return { error: String(res.error) };
    const out = res.stdout && res.stdout.trim() ? res.stdout.trim() : '';
    if (!out) return { stdout: out, stderr: res.stderr };
    try {
      return JSON.parse(out);
    } catch (e) {
      return { stdout: out, stderr: res.stderr };
    }
  } catch (e) {
    return { error: String(e) };
  }
}

ipcMain.handle('engine/scan', async () => {
  const pyRes = runPythonScript('scripts/advance_cleaner_engine.py', ['--action', 'scan']);
  if (pyRes && !pyRes.error) return pyRes;
  try {
    const res = await engine.scan();
    return res;
  } catch (e) {
    return { error: String(e) };
  }
});

ipcMain.handle('engine/cleanup', async (event, opts) => {
  // opts may include paths
  const args = ['--action', 'cleanup', '--do-clean', '--confirm'];
  if (opts && opts.paths && Array.isArray(opts.paths)) args.push('--paths', ...opts.paths);
  const pyRes = runPythonScript('scripts/advance_cleaner_engine.py', args);
  if (pyRes && !pyRes.error) return pyRes;
  try {
    const res = await engine.cleanup(opts);
    return res;
  } catch (e) {
    return { error: String(e) };
  }
});

ipcMain.handle('engine/scan-virus', async () => {
  const pyRes = runPythonScript('scripts/advance_cleaner_engine.py', ['--action', 'virus']);
  if (pyRes && !pyRes.error) return pyRes;
  try {
    const res = await engine.scanVirus();
    return res;
  } catch (e) {
    return { error: String(e) };
  }
});

// Update handlers
ipcMain.handle('app:check-for-updates', async () => {
  if (!autoUpdater) return { available: false, error: 'updater-unavailable' };
  try {
    const res = await autoUpdater.checkForUpdates();
    return { available: !!res.updateInfo.version, info: res.updateInfo };
  } catch (e) {
    return { available: false, error: String(e) };
  }
});

ipcMain.handle('app:download-update', async () => {
  if (!autoUpdater) return { ok: false, error: 'updater-unavailable' };
  try {
    autoUpdater.downloadUpdate();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});

ipcMain.handle('app:apply-update', async () => {
  if (!autoUpdater) return { ok: false, error: 'updater-unavailable' };
  try {
    autoUpdater.quitAndInstall();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
