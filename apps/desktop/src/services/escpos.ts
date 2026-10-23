/**
 * ESC/POS 小票字节流生成（GBK 编码，适配国产热敏打印机内置字库）。
 * 58mm 纸按 32 半角列宽，80mm 按 48。
 */
import * as iconv from 'iconv-lite';
import type { SaleOrderDto } from '@pos/shared-types';
import { PAYMENT_METHOD_LABELS } from '@pos/shared-types';
import { fenToYuan, formatDateTime } from '@/utils/money';

const ESC = 0x1b;
const GS = 0x1d;

export function charsWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0xff ? 2 : 1;
  return w;
}

/** 一行内容的左右对齐：label 靠左、value 靠右；放不下时 value 拆成单独一行 */
function rowLines(label: string, value: string, width: number): string[] {
  const valueWidth = charsWidth(value);
  if (charsWidth(label) + valueWidth <= width) {
    return [label.padEnd(width - valueWidth, ' ')];
  }
  return [label, value.padStart(Math.max(0, width - valueWidth), ' ')];
}

/** 按显示宽度截断（CJK 计 2 列） */
function truncate(s: string, width: number): string {
  const out: string[] = [];
  let w = 0;
  for (const ch of s) {
    const cw = ch.charCodeAt(0) > 0xff ? 2 : 1;
    if (w + cw > width) break;
    out.push(ch);
    w += cw;
  }
  return out.join('');
}

class EscPosBuilder {
  private chunks: number[][] = [];

  push(...bytes: number[]) {
    this.chunks.push(bytes);
  }

  /** 追加一段已编码的字节 */
  writeBytes(bytes: Uint8Array) {
    this.chunks.push([...bytes]);
  }

  /** 按行输出文本（自动补换行指令） */
  text(s: string) {
    this.writeBytes(iconv.encode(s, 'gbk'));
    this.push(0x0a);
  }

  lines(list: string[]) {
    for (const line of list) this.text(line);
  }

  init() {
    this.push(ESC, 0x40);
  }

  align(mode: 0 | 1 | 2) {
    this.push(ESC, 0x61, mode);
  }

  /** 0x00 常规，0x30 倍宽倍高，0x20 倍高，0x10 倍宽 */
  size(mode: 0x00 | 0x10 | 0x20 | 0x30) {
    this.push(ESC, 0x21, mode);
  }

  divider(width: number) {
    this.text('-'.repeat(width));
  }

  row(label: string, value: string, width: number) {
    this.lines(rowLines(label, value, width));
  }

  feed(n: number) {
    this.push(ESC, 0x64, n);
  }

  cut() {
    this.push(GS, 0x56, 0x00);
  }

  toBase64(): string {
    return Buffer.from(this.chunks.flat()).toString('base64');
  }
}

export function buildEscPosReceipt(opts: {
  order: SaleOrderDto;
  cashierName: string;
  storeName: string;
  storePhone: string;
  storeAddress: string;
  receiptFooter: string;
  paperWidth: number;
  offline?: boolean;
}): string {
  const { order } = opts;
  const width = opts.paperWidth >= 80 ? 48 : 32;
  const b = new EscPosBuilder();

  b.init();
  b.align(1);
  b.size(0x30);
  b.text(truncate(opts.storeName || '收银小票', width));
  b.size(0x00);
  if (opts.storePhone) b.text(opts.storePhone);
  if (opts.storeAddress) b.text(truncate(opts.storeAddress, width));
  b.align(0);
  b.divider(width);
  b.text(`单号:${order.orderNo}`);
  b.text(`时间:${formatDateTime(order.createdAt)}`);
  b.text(`收银:${opts.cashierName}`);
  if (opts.offline) b.text('** 离线单 · 待同步 **');
  b.divider(width);

  for (const item of order.items) {
    const name = item.productName + (item.spec ? ` ${item.spec}` : '');
    b.text(truncate(name, width));
    b.row(`${fenToYuan(item.unitPrice)} x${item.qty}${item.unit}`, fenToYuan(item.subtotal), width);
    if (item.refundedQty > 0) b.text(`  (已退 ${item.refundedQty})`);
  }

  b.divider(width);
  b.row('合计:', fenToYuan(order.totalAmount), width);
  if (order.discountAmount > 0) b.row('优惠:', `-${fenToYuan(order.discountAmount)}`, width);
  b.align(2);
  b.size(0x30);
  b.text(`实收: ${fenToYuan(order.payableAmount)}`);
  b.size(0x00);
  b.align(0);
  for (const p of order.payments) {
    b.row(`${PAYMENT_METHOD_LABELS[p.method]}:`, fenToYuan(p.amount), width);
  }
  b.divider(width);
  b.align(1);
  if (opts.receiptFooter) b.text(truncate(opts.receiptFooter, width));
  b.feed(3);
  b.cut();
  return b.toBase64();
}
