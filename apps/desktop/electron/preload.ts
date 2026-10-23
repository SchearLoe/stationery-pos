import { contextBridge, ipcRenderer } from 'electron';

/**
 * 渲染进程可用的桥接 API。
 * print.html   —— 经 Windows 打印驱动打印 HTML 小票（可静默）
 * print.escpos —— ESC/POS 直连（winspool RAW 指令）
 * print.list   —— 枚举本机打印机
 */
contextBridge.exposeInMainWorld('posApp', {
  desktop: true,
  platform: process.platform,
  print: {
    list: () => ipcRenderer.invoke('pos:print:list'),
    html: (opts: { html: string; deviceName?: string; silent: boolean }) =>
      ipcRenderer.invoke('pos:print:html', opts),
    escpos: (opts: { base64: string; printerName: string }) =>
      ipcRenderer.invoke('pos:print:escpos', opts),
  },
});
