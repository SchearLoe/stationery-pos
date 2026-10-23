import { contextBridge } from 'electron';

/**
 * 渲染进程可用的最小桥接 API。
 * 后续硬件（ESC/POS 打印、钱箱）能力从这里扩展。
 */
contextBridge.exposeInMainWorld('posApp', {
  desktop: true,
  platform: process.platform,
});
