import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { listPrinters, printHtml, printEscposDirect } from './printer';

const isDev = !!process.env.VITE_DEV;

function createWindow() {
  const win = new BrowserWindow({
    width: 1366,
    height: 860,
    minWidth: 1100,
    minHeight: 700,
    title: '文具店收银系统',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    void win.loadURL('http://127.0.0.1:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    void win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
  return win;
}

// 打印能力（主进程实现，渲染进程经 preload 桥调用）
ipcMain.handle('pos:print:list', async (event) => listPrinters(event.sender));
ipcMain.handle('pos:print:html', async (_event, opts: { html: string; deviceName?: string; silent: boolean }) =>
  printHtml(opts),
);
ipcMain.handle('pos:print:escpos', async (_event, opts: { base64: string; printerName: string }) =>
  printEscposDirect(opts),
);

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
