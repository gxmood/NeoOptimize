const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const child = require('child_process');

let lastScanResults = null;

async function folderSizeAndFiles(root, patterns) {
  const files = [];
  let total = 0;
  async function walk(dir) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    await Promise.all(entries.map(async (ent) => {
      const full = path.join(dir, ent.name);
      try {
        if (ent.isDirectory()) return await walk(full);
        const stat = await fsp.stat(full);
        const ext = path.extname(ent.name).toLowerCase();
        const matches = patterns.some((p) => p === ext || ent.name.toLowerCase().includes(p));
        if (matches) {
          files.push({ path: full, size: stat.size });
          total += stat.size;
        }
      } catch (e) {
        // ignore individual file errors
      }
    }));
  }
  await walk(root);
  return { total, files };
}

async function scan() {
  const candidates = [];
  const systemRoot = process.env.SystemRoot || (process.platform === 'win32' ? 'C:\\Windows' : '/');
  // user temp
  candidates.push({ id: 'user_temp', desc: 'User Temp', path: os.tmpdir() });
  // windows temp
  candidates.push({ id: 'windows_temp', desc: 'Windows Temp', path: path.join(systemRoot, 'Temp') });
  // prefetch (windows)
  candidates.push({ id: 'prefetch', desc: 'Prefetch', path: path.join(systemRoot, 'Prefetch') });
  // recent
  candidates.push({ id: 'recent', desc: 'Recent Files', path: path.join(process.env.USERPROFILE || '', 'Recent') });
  // explorer thumbnails cache
  candidates.push({ id: 'thumb_cache', desc: 'Thumbnail Cache', path: path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Windows', 'Explorer') });

  const patterns = ['.tmp', '.log', '.cache', '.old', '.bak', '.dmp', 'thumbs.db', '.chk'];

  const results = [];
  for (const c of candidates) {
    try {
      if (!c.path) continue;
      const exists = fs.existsSync(c.path);
      if (!exists) continue;
      const res = await folderSizeAndFiles(c.path, patterns);
      results.push({ id: c.id, desc: c.desc, path: c.path, sizeBytes: res.total, fileCount: res.files.length, sample: res.files.slice(0, 100) });
    } catch (e) {
      // continue
    }
  }

  // also include free disk space info for root
  const rootPath = process.platform === 'win32' ? (process.env.SystemDrive || 'C:') + '\\' : '/';
  let diskFree = null;
  try {
    // node doesn't have cross platform disk free; use child process 'wmic' on windows
    if (process.platform === 'win32') {
      const out = child.execSync('wmic logicaldisk get size,freespace,caption');
      diskFree = out.toString();
    }
  } catch (e) {
    diskFree = null;
  }

  lastScanResults = { time: new Date().toISOString(), host: os.hostname(), results, diskInfo: diskFree };
  return lastScanResults;
}

async function cleanup(ids) {
  if (!lastScanResults) return { error: 'no-scan' };
  const toClean = !ids || ids.length === 0 ? lastScanResults.results : lastScanResults.results.filter((r) => ids.includes(r.id));
  let freed = 0;
  const cleaned = [];
  for (const item of toClean) {
    for (const f of item.sample || []) {
      try {
        await fsp.rm(f.path, { force: true });
        freed += f.size || 0;
        cleaned.push(f.path);
      } catch (e) {
        // ignore
      }
    }
    // attempt to remove empty directories under the item.path (best-effort)
    try {
      const entries = await fsp.readdir(item.path).catch(() => []);
      if (entries.length === 0) {
        await fsp.rmdir(item.path).catch(() => {});
      }
    } catch (e) {}
  }
  return { success: true, freedBytes: freed, freedMB: Math.round(freed / (1024 * 1024)), cleaned };
}

async function scanVirus() {
  // try to locate msert
  const candidates = [
    'D:\\NeoOptimize\\msert x64\\msert.exe',
    'D:\\NeoOptimize\\msert x32\\msert.exe',
    'D:\\NeoOptimize\\msert.exe'
  ];
  let found = null;
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      found = c;
      break;
    }
  }
  if (!found) return { found: false, error: 'msert not found in D:\\NeoOptimize' };

  try {
    // run with --scan (best-effort). Capture stdout and stderr
    const out = child.spawnSync(found, ['--scan'], { windowsHide: true, timeout: 1000 * 60 * 10 });
    const stdout = out.stdout ? out.stdout.toString() : '';
    const stderr = out.stderr ? out.stderr.toString() : '';
    return { found: true, path: found, exitCode: out.status, stdout, stderr };
  } catch (e) {
    return { found: true, path: found, error: String(e) };
  }
}

module.exports = { scan, cleanup, scanVirus };
