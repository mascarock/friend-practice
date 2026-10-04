// Adapted from the Vibefy 1.3.8 companion: isolated window, bundled child
// runtime, startup health check, single instance, and graceful child shutdown.
import { app, BrowserWindow, Menu, session } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { terminateChild } from './child-lifecycle.mjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(moduleDir, '..');
const port = 43130;
const origin = `http://127.0.0.1:${port}`;
const token = randomBytes(32).toString('hex');
const offscreen = process.env.LOCAL_COMPUTER_OFFSCREEN === '1';
app.setName('Local Computer');
// Isolated profile for automated demo capture; no production data is changed.
if (process.env.LOCAL_COMPUTER_DEMO_PROFILE) app.setPath('userData', process.env.LOCAL_COMPUTER_DEMO_PROFILE);
let windowRef;
let companion;
let quitting = false;
let ready = false;
let log = '';

function createWindow() {
  windowRef = new BrowserWindow({
    width: 1280, height: 920, minWidth: 960, minHeight: 700,
    show: !offscreen,
    title: 'Local Computer', backgroundColor: '#0a0a0a', titleBarStyle: 'hiddenInset',
    webPreferences: { offscreen, preload: path.join(moduleDir, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  windowRef.webContents.setAudioMuted(true);
  windowRef.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  windowRef.webContents.on('will-navigate', (event, url) => {
    if (url !== `${origin}/computer`) event.preventDefault();
  });
  windowRef.webContents.on('will-attach-webview', (event) => event.preventDefault());
  windowRef.on('closed', () => { windowRef = null; });
  if (ready) void windowRef.loadURL(`${origin}/computer`);
  else void windowRef.loadFile(path.join(moduleDir, 'index.html'));
}

async function startCompanion() {
  const server = app.isPackaged ? path.join(process.resourcesPath, 'server') : path.join(root, '.next-desktop/standalone');
  companion = spawn(process.execPath, ['--require', path.join(moduleDir, 'local-only.cjs'), path.join(server, 'server.js')], {
    cwd: server,
    env: {
      PATH: process.env.PATH, HOME: app.getPath('home'), TMPDIR: app.getPath('temp'),
      ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
      HOSTNAME: '127.0.0.1', PORT: String(port), LOCAL_COMPUTER_TOKEN: token, LOCAL_COMPUTER_PARENT: String(process.pid),
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const addLog = (chunk) => { log = (log + chunk.toString()).slice(-4000); };
  companion.stdout.on('data', addLog);
  companion.stderr.on('data', addLog);
  let failure;
  companion.once('error', (error) => { failure = error; });
  companion.once('exit', (code) => {
    if (!quitting && ready) {
      ready = false;
      showError(`The local runtime stopped (${code}). Quit and reopen Local Computer.`);
    }
  });
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    if (companion.exitCode !== null) throw new Error(`The local runtime could not start. ${log}`);
    try {
      const response = await fetch(`${origin}/computer`, { headers: { 'x-local-computer': token }, signal: AbortSignal.timeout(1000), redirect: 'error' });
      if (response.ok && response.headers.get('x-local-computer') === token) {
        await session.defaultSession.cookies.set({ url: origin, name: 'local-computer', value: token, httpOnly: true, sameSite: 'strict' });
        ready = true;
        await windowRef?.loadURL(`${origin}/computer`);
        return;
      }
    } catch { /* Wait for our authenticated local runtime. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('The local runtime did not start. Port 43130 may be occupied. Quit and reopen Local Computer.');
}

async function showError(message) {
  if (!windowRef) createWindow();
  await windowRef.loadFile(path.join(moduleDir, 'index.html'));
  await windowRef.webContents.executeJavaScript(`document.getElementById('status').textContent = ${JSON.stringify(message)}`);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (!windowRef) createWindow(); windowRef.show(); windowRef.focus(); });
  app.whenReady().then(async () => {
    if (offscreen) app.dock?.hide();
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      callback({ cancel: !(url.origin === origin || url.protocol === 'file:' || url.protocol === 'devtools:') });
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Local Computer', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] },
      { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
      { label: 'Window', submenu: [{ role: 'minimize' }, { role: 'zoom' }] },
    ]));
    createWindow();
    try { await startCompanion(); } catch (error) { await showError(error.message); }
  });
  app.on('activate', () => { if (!windowRef) createWindow(); });
  app.on('before-quit', (event) => {
    if (quitting) return;
    event.preventDefault(); quitting = true;
    void terminateChild(companion).finally(() => app.exit(0));
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
