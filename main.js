const { app, BrowserWindow, dialog, ipcMain, clipboard, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');

const MEDIA_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.mp4', '.mov', '.m4v', '.webm', '.avi']);
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']);

function storePath() { return path.join(app.getPath('userData'), 'library.json'); }
async function readStore() {
  try { return JSON.parse(await fs.readFile(storePath(), 'utf8')); }
  catch { return { sources: [], collections: [], assetMeta: {}, passwordHash: null }; }
}
async function writeStore(value) { await fs.writeFile(storePath(), JSON.stringify(value, null, 2), 'utf8'); }

async function scanDirectory(folder) {
  const results = [];
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    await Promise.all(entries.map(async entry => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(fullPath);
      if (!entry.isFile() || !MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) return;
      try {
        const stat = await fs.stat(fullPath);
        results.push({ id: crypto.createHash('sha1').update(fullPath).digest('hex'), path: fullPath, name: entry.name, type: imageExtensions.has(path.extname(entry.name).toLowerCase()) ? 'image' : 'video', modified: stat.mtimeMs });
      } catch { /* skipped */ }
    }));
  }
  await walk(folder);
  return results.sort((a, b) => b.modified - a.modified);
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1480, height: 920, minWidth: 1050, minHeight: 700,
    titleBarStyle: 'hidden', backgroundColor: '#111217',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true }
  });
  window.loadFile('index.html');
}

app.whenReady().then(() => {
  ipcMain.handle('store:read', readStore);
  ipcMain.handle('store:write', (_, value) => writeStore(value));
  ipcMain.handle('folders:pick', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle('folder:scan', (_, folder) => scanDirectory(folder));
  ipcMain.handle('image:copy', (_, filePath) => {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return false;
    clipboard.writeImage(image);
    return true;
  });
  ipcMain.handle('image:show-in-folder', (_, filePath) => shell.showItemInFolder(filePath));
  ipcMain.handle('app:lock', () => app.quit());
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
