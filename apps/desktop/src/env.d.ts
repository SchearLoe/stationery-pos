/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}

export interface PrinterInfo {
  name: string;
  displayName?: string;
  isDefault?: boolean;
  status?: number;
}

declare global {
  interface Window {
    /** Electron preload 桥；浏览器环境不存在 */
    posApp?: {
      desktop: boolean;
      platform: string;
      print: {
        list: () => Promise<PrinterInfo[]>;
        html: (opts: { html: string; deviceName?: string; silent: boolean }) => Promise<void>;
        escpos: (opts: { base64: string; printerName: string }) => Promise<void>;
      };
    };
  }
}

export {};
