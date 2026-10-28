import { BadRequestException } from '@nestjs/common';
import { randomInt } from 'node:crypto';

/**
 * 生成店内码：EAN-13 保留的 20~29 前缀段，供无条码商品使用。
 * 结构：2 + 9位时间戳取模 + 1位随机 + 1位校验位（mod10 加权和）
 */
export function genStoreBarcode(): string {
  const ts = (Date.now() % 1_000_000_000).toString().padStart(9, '0');
  const rand = Math.floor(Math.random() * 10).toString();
  const body = `2${ts}${rand}`; // 11 位
  return body + checkDigit(body);
}

/** EAN-13 校验位计算 */
export function checkDigit(digits12: string): string {
  if (!/^\d{12}$/.test(digits12) && !/^\d{11}$/.test(digits12)) {
    throw new BadRequestException('条码格式错误');
  }
  const src = digits12.padEnd(12, '0');
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(src[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return ((10 - (sum % 10)) % 10).toString();
}

/** 校验条码合法性：数字、长度 6~20；EAN-13 需校验位正确（店内码除外） */
export function validateBarcode(barcode: string): void {
  if (!/^\d{6,20}$/.test(barcode)) {
    throw new BadRequestException(`条码 ${barcode} 不合法（应为 6~20 位数字）`);
  }
  if (barcode.length === 13 && !barcode.startsWith('2')) {
    const expected = checkDigit(barcode.slice(0, 12));
    if (expected !== barcode[12]) {
      throw new BadRequestException(`条码 ${barcode} 校验位错误`);
    }
  }
}

/** 生成单号：前缀 + yyyyMMdd + 4位当日随机（冲突由唯一约束兜底重试） */
export function genOrderNo(prefix: 'S' | 'R' | 'P' | 'T'): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .toUpperCase()
    .padStart(4, '0');
  return `${prefix}${ymd}-${rand}`;
}

/** 会员码字符集：去掉易混淆的 0/O/1/I */
const MEMBER_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 生成会员码：M + 8 位随机字母数字（防猜测，唯一约束兜底重试） */
export function genMemberCode(): string {
  const chars: string[] = [];
  for (let i = 0; i < 8; i++) {
    chars.push(MEMBER_CODE_ALPHABET[randomInt(0, MEMBER_CODE_ALPHABET.length)]!);
  }
  return `M${chars.join('')}`;
}
