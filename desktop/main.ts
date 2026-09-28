import { app, BrowserWindow, dialog } from 'electron';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/index.js';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
let server: Awaited<ReturnType<typeof startServer>> | undefined;
let mainWindow: BrowserWindow | undefined;
let stoppingServer = false;

async function chooseFile(mode: 'open' | 'save'): Promise<string | null> {
  if (mode === 'open') {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'] });
    return result.canceled ? null : result.filePaths[0] ?? null;
  }

  const result = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: join(app.getPath('home'), 'kubeconfig-new'),
  });
  return result.canceled ? null : result.filePath ?? null;
}

async function openAppWindow() {
  if (!server) {
    server = await startServer({
      port: 0,
      assetsDirectory: app.isPackaged
        ? join(app.getAppPath(), 'dist')
        : resolve(moduleDirectory, '../../dist'),
      fileDialog: chooseFile,
    });
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 980,
    minHeight: 680,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const localOrigin = server.url;
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (new URL(targetUrl).origin !== localOrigin) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.on('closed', () => { mainWindow = undefined; });
  await mainWindow.loadURL(localOrigin);
}

app.on('before-quit', (event) => {
  if (!server || stoppingServer) return;
  event.preventDefault();
  stoppingServer = true;
  const runningServer = server;
  void runningServer.close().catch(() => {}).finally(() => {
    server = undefined;
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void openAppWindow().catch(() => {
      console.error('Kubeconfig Manager could not start.');
      app.quit();
    });
  }
});

void app.whenReady().then(openAppWindow).catch(() => {
  console.error('Kubeconfig Manager could not start.');
  app.quit();
});