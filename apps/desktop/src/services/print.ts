/**
 * 打印服务：按系统设置分流。
 * - ESC/POS 直连开启：指令字节送打印机字库（最快、最省纸，58/80mm）
 * - 否则若启用小票打印：经 Windows 打印驱动输出 HTML 小票
 * - 均未开启：返回未启用提示（打印是可选功能，不影响收款流程）
 */
import type { SaleOrderDto } from '@pos/shared-types';
import { useSettingsStore } from '@/stores/settings';
import { buildEscPosReceipt } from './escpos';
import { buildReceiptHtml } from './receipt-html';

export interface PrintResult {
  ok: boolean;
  message: string;
}

export function receiptPrintConfigured(): boolean {
  const s = useSettingsStore().settings;
  return !!(s.receiptPrintingEnabled || (s.escposDirectEnabled && s.escposPrinterName));
}

export async function printReceipt(
  order: SaleOrderDto,
  cashierName: string,
  offline = false,
): Promise<PrintResult> {
  const s = useSettingsStore().settings;
  const bridge = window.posApp;
  if (!bridge) {
    return { ok: false, message: '打印仅支持桌面端（Electron），请在收银机应用内使用' };
  }

  try {
    if (s.escposDirectEnabled && s.escposPrinterName) {
      const base64 = buildEscPosReceipt({
        order,
        cashierName,
        storeName: s.storeName,
        storePhone: s.storePhone,
        storeAddress: s.storeAddress,
        receiptFooter: s.receiptFooter,
        paperWidth: s.receiptPaperWidth,
        offline,
      });
      await bridge.print.escpos({ base64, printerName: s.escposPrinterName });
      return { ok: true, message: '已直连打印' };
    }

    if (s.receiptPrintingEnabled) {
      const html = buildReceiptHtml({ order, cashierName, settings: s, offline });
      await bridge.print.html({ html, silent: !!s.autoPrintReceipt });
      return { ok: true, message: '已发送到打印机' };
    }

    return { ok: false, message: '打印功能未开启，可在「系统设置 → 打印设置」中开启' };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : '打印失败' };
  }
}
