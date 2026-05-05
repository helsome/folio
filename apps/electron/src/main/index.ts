import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { AgentGateway, toIpcResult } from './agentGateway';

let mainWindow: BrowserWindow | null = null;
const agentGateway = new AgentGateway();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Load the app
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
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

// Finance Agent MVP IPC
ipcMain.handle('agent:send', async (_event, message: unknown) =>
  toIpcResult(() => agentGateway.send(message))
);

ipcMain.handle('agent:getTools', async () =>
  toIpcResult(() => agentGateway.getTools())
);

ipcMain.handle('market:getQuote', async (_event, symbol: unknown) =>
  toIpcResult(() => agentGateway.getQuote(symbol))
);

ipcMain.handle('market:getKline', async (_event, request: unknown) =>
  toIpcResult(() => agentGateway.getKline(request))
);

ipcMain.handle('market:getPortfolio', async () =>
  toIpcResult(() => agentGateway.getPortfolio())
);

ipcMain.handle('longbridge:getStatus', async () =>
  toIpcResult(() => agentGateway.getLongBridgeStatus())
);

ipcMain.handle('alerts:load', async () =>
  toIpcResult(() => agentGateway.loadAlerts())
);

ipcMain.handle('alerts:save', async (_event, alerts: unknown) =>
  toIpcResult(() => agentGateway.saveAlerts(alerts))
);
