const { app, BrowserWindow, dialog, ipcMain, clipboard, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');

const MEDIA_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif', '.mp4', '.mov', '.m4v', '.webm', '.avi']);
const imageExtensions = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.avif']);
const WEB_IMPORTS_SOURCE_ID = 'allsight-web-imports';
const BRIDGE_PORT = 41741;

function storePath() { return path.join(app.getPath('userData'), 'library.json'); }
async function readStore() {
  try { return JSON.parse(await fs.promises.readFile(storePath(), 'utf8')); }
  catch { return { sources: [], collections: [], assetMeta: {}, passwordHash: null }; }
}
async function writeStore(value) { await fs.promises.writeFile(storePath(), JSON.stringify(value, null, 2), 'utf8'); }

async function scanDirectory(folder) {
  const results = [];
  async function walk(dir) {
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    await Promise.all(entries.map(async entry => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(fullPath);
      if (!entry.isFile() || !MEDIA_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) return;
      try {
        const stat = await fs.promises.stat(fullPath);
        results.push({ id: crypto.createHash('sha1').update(fullPath).digest('hex'), path: fullPath, name: entry.name, type: imageExtensions.has(path.extname(entry.name).toLowerCase()) ? 'image' : 'video', modified: stat.mtimeMs });
      } catch { /* skipped */ }
    }));
  }
  await walk(folder);
  return results.sort((a, b) => b.modified - a.modified);
}

function extensionImportsPath() { return path.join(app.getPath('pictures'), 'AllSight Web Imports'); }
function broadcast(channel, value) { BrowserWindow.getAllWindows().forEach(window => window.webContents.send(channel, value)); }
function safeImportName(value) {
  const clean = String(value || '').replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '');
  return clean.slice(0, 90) || `web-image-${Date.now()}`;
}
function extensionFor(contentType, sourceUrl) {
  const byType = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp', 'image/avif': '.avif', 'image/bmp': '.bmp' };
  if (byType[String(contentType || '').split(';')[0].toLowerCase()]) return byType[String(contentType).split(';')[0].toLowerCase()];
  const extension = path.extname(new URL(sourceUrl).pathname).toLowerCase();
  return imageExtensions.has(extension) ? extension : '.jpg';
}
async function importWebImage(sourceUrl) {
  let url;
  try { url = new URL(sourceUrl); } catch { throw new Error('Invalid image URL'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Only web image URLs are supported');
  const response = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'AllSight Web Importer' } });
  if (!response.ok) throw new Error(`Download failed (${response.status})`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.startsWith('image/')) throw new Error('The dropped item is not an image');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > 80 * 1024 * 1024) throw new Error('Image is empty or too large');
  const directory = extensionImportsPath();
  await fs.promises.mkdir(directory, { recursive: true });
  const base = safeImportName(path.basename(url.pathname, path.extname(url.pathname)));
  const target = path.join(directory, `${base}-${Date.now()}${extensionFor(contentType, url.href)}`);
  await fs.promises.writeFile(target, bytes);
  const data = await readStore();
  let source = data.sources?.find(item => item.id === WEB_IMPORTS_SOURCE_ID);
  if (!source) {
    source = { id: WEB_IMPORTS_SOURCE_ID, path: directory, name: 'Web Imports', assets: [] };
    data.sources = [...(data.sources || []), source];
  }
  source.assets = await scanDirectory(directory);
  await writeStore(data);
  const asset = source.assets.find(item => item.path === target);
  broadcast('media:imported', { asset, sourceId: source.id });
  return asset;
}
function sendBridgeResponse(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' });
  response.end(JSON.stringify(data));
}
function startExtensionBridge() {
  const server = http.createServer((request, response) => {
    if (request.method === 'OPTIONS') return sendBridgeResponse(response, 204, {});
    if (request.method !== 'POST' || request.url !== '/import') return sendBridgeResponse(response, 404, { ok: false, error: 'Not found' });
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > 32 * 1024) request.destroy();
    });
    request.on('end', async () => {
      try {
        const asset = await importWebImage(JSON.parse(body).url);
        sendBridgeResponse(response, 201, { ok: true, asset: { id: asset.id, name: asset.name } });
      } catch (error) { sendBridgeResponse(response, 400, { ok: false, error: error.message || 'Import failed' }); }
    });
  });
  server.on('error', error => console.warn('AllSight extension bridge unavailable:', error.message));
  server.listen(BRIDGE_PORT, '127.0.0.1');
  return server;
}

const folderWatchers = new Map();
function stopFolderWatchers() {
  folderWatchers.forEach(({ watcher, timer }) => {
    clearTimeout(timer);
    watcher.close();
  });
  folderWatchers.clear();
}
function watchFolders(webContents, folders) {
  stopFolderWatchers();
  [...new Set(folders.filter(Boolean))].forEach(folder => {
    try {
      const record = { watcher: null, timer: null };
      record.watcher = fs.watch(folder, { recursive: true }, () => {
        // File managers commonly emit several events for one copy/move operation.
        clearTimeout(record.timer);
        record.timer = setTimeout(() => {
          if (!webContents.isDestroyed()) webContents.send('folder:changed', folder);
        }, 450);
      });
      record.watcher.on('error', () => { /* Folder may have been disconnected or removed. */ });
      folderWatchers.set(folder, record);
    } catch { /* An unavailable source folder is handled by the next scan. */ }
  });
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
  ipcMain.handle('sources:watch', (event, folders) => {
    watchFolders(event.sender, Array.isArray(folders) ? folders : []);
  });
  ipcMain.handle('image:copy', (_, filePath) => {
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return false;
    clipboard.writeImage(image);
    return true;
  });
  ipcMain.handle('image:show-in-folder', (_, filePath) => shell.showItemInFolder(filePath));
  ipcMain.handle('app:lock', () => app.quit());
  startExtensionBridge();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', stopFolderWatchers);
