/**
 * 小票独立 HTML 文档生成：交给 Electron 隐藏窗口经系统打印驱动输出。
 * 纸宽 58/80mm 由设置控制。
 */
import type { SaleOrderDto, StoreSettings } from '@pos/shared-types';
import { PAYMENT_METHOD_LABELS } from '@pos/shared-types';
import { fenToYuan, formatDateTime } from '@/utils/money';

export function buildReceiptHtml(opts: {
  order: SaleOrderDto;
  cashierName: string;
  settings: StoreSettings;
  offline?: boolean;
}): string {
  const { order, settings } = opts;
  const widthMm = settings.receiptPaperWidth >= 80 ? 80 : 58;
  const items = order.items
    .map(
      (i) => `
      <div class="item">
        <div>${escapeHtml(i.productName)}${i.spec ? ` ${escapeHtml(i.spec)}` : ''}</div>
        <div class="row"><span>${fenToYuan(i.unitPrice)} × ${i.qty}${i.unit}</span><span>${fenToYuan(i.subtotal)}</span></div>
        ${i.refundedQty > 0 ? `<div class="muted">(已退 ${i.refundedQty})</div>` : ''}
      </div>`,
    )
    .join('');
  const payments = order.payments
    .map((p) => `<div class="row"><span>${PAYMENT_METHOD_LABELS[p.method]}：</span><span>${fenToYuan(p.amount)}</span></div>`)
    .join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<style>
  @page { margin: 3mm; size: ${widthMm}mm auto; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${widthMm - 6}mm;
    font-family: 'SimSun', 'Courier New', monospace;
    font-size: ${widthMm >= 80 ? 12 : 11}px;
    color: #000;
  }
  .shop { text-align: center; font-size: ${widthMm >= 80 ? 18 : 15}px; font-weight: bold; }
  .sub { text-align: center; font-size: 10px; }
  .hr { border-top: 1px dashed #000; margin: 4px 0; }
  .row { display: flex; justify-content: space-between; line-height: 1.6; }
  .item { line-height: 1.5; }
  .total { font-size: 14px; font-weight: bold; }
  .pay { font-size: 15px; font-weight: bold; }
  .muted { color: #444; font-size: 10px; }
  .offline { text-align: center; font-weight: bold; }
  .footer { text-align: center; margin-top: 4px; }
</style>
</head>
<body>
  <div class="shop">${escapeHtml(settings.storeName)}</div>
  ${settings.storePhone ? `<div class="sub">${escapeHtml(settings.storePhone)}</div>` : ''}
  ${settings.storeAddress ? `<div class="sub">${escapeHtml(settings.storeAddress)}</div>` : ''}
  <div class="hr"></div>
  <div class="row"><span>单号：</span><span>${order.orderNo}</span></div>
  <div class="row"><span>时间：</span><span>${formatDateTime(order.createdAt)}</span></div>
  <div class="row"><span>收银：</span><span>${escapeHtml(opts.cashierName)}</span></div>
  ${opts.offline ? '<div class="offline">** 离线单 · 待同步 **</div>' : ''}
  <div class="hr"></div>
  ${items}
  <div class="hr"></div>
  <div class="row"><span>合计：</span><span>${fenToYuan(order.totalAmount)}</span></div>
  ${order.discountAmount > 0 ? `<div class="row"><span>优惠：</span><span>-${fenToYuan(order.discountAmount)}</span></div>` : ''}
  <div class="row pay"><span>实收：</span><span>¥${fenToYuan(order.payableAmount)}</span></div>
  ${payments}
  <div class="hr"></div>
  <div class="footer">${escapeHtml(settings.receiptFooter ?? '')}</div>
</body>
</html>`;
}

function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
