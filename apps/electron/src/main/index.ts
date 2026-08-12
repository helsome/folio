import { app, BrowserWindow, ipcMain } from 'electron';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { AgentKernelHost, toIpcResult } from './kernelHost.ts';
import { loadFinagentEnv } from './loadEnv.ts';

let mainWindow: BrowserWindow | null = null;
const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, '../..');
const workspaceRoot = join(__dirname, '../../../..');
loadFinagentEnv({
  roots: [
    workspaceRoot,
    appRoot,
  ],
});
const agentKernelHost = new AgentKernelHost();
const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Forward kernel agent events to the renderer.
  agentKernelHost.attach(mainWindow);

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    if (process.env.FINAGENT_OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools();
    }
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  void agentKernelHost.dispose();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers for window controls
ipcMain.handle('window:minimize', () => mainWindow?.minimize());

ipcMain.handle('window:maximize', () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow?.maximize();
  }
});

ipcMain.handle('window:close', () => mainWindow?.close());

ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized());

// Agent Kernel IPC
ipcMain.handle('kernel:hydrate', async () =>
  toIpcResult(() => agentKernelHost.hydrate())
);

ipcMain.handle('sessions:create', async (_event, title: unknown) =>
  toIpcResult(() => agentKernelHost.createSession(title))
);

ipcMain.handle('sessions:delete', async (_event, sessionId: unknown) =>
  toIpcResult(() => agentKernelHost.deleteSession(sessionId))
);

ipcMain.handle('sessions:getMessages', async (_event, sessionId: unknown) =>
  toIpcResult(() => agentKernelHost.getMessages(sessionId))
);

ipcMain.handle('sessions:listRuns', async (_event, sessionId: unknown) =>
  toIpcResult(() => agentKernelHost.listRuns(sessionId))
);

ipcMain.handle('runs:start', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.startRun(input))
);

ipcMain.handle('runs:cancel', async (_event, input: unknown) =>
  toIpcResult(() => agentKernelHost.cancelRun(input))
);

ipcMain.handle('agent:getTools', async () =>
  toIpcResult(() => agentKernelHost.getTools())
);

ipcMain.handle('market:getQuote', async (_event, symbol: unknown) =>
  toIpcResult(() => agentKernelHost.getQuote(symbol))
);

ipcMain.handle('market:getKline', async (_event, request: unknown) =>
  toIpcResult(() => agentKernelHost.getKline(request))
);

ipcMain.handle('market:getPortfolio', async () =>
  toIpcResult(() => agentKernelHost.getPortfolio())
);

ipcMain.handle('longbridge:getStatus', async () =>
  toIpcResult(() => agentKernelHost.getLongBridgeStatus())
);

ipcMain.handle('alerts:load', async () =>
  toIpcResult(() => agentKernelHost.loadAlerts())
);

ipcMain.handle('alerts:save', async (_event, alerts: unknown) =>
  toIpcResult(() => agentKernelHost.saveAlerts(alerts))
);
