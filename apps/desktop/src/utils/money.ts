/** 金额工具：数据库与接口一律用「分」（整数），界面展示用「元」 */

export function fenToYuan(fen: number | null | undefined): string {
  if (fen === null || fen === undefined) return '';
  return (fen / 100).toFixed(2);
}

export function yuanToFen(yuan: string | number | null | undefined): number {
  if (yuan === '' || yuan === null || yuan === undefined) return 0;
  const n = Number(yuan);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

/** 分 → 显示（带 ¥） */
export function money(fen: number | null | undefined): string {
  return `¥${fenToYuan(fen)}`;
}

export function formatDateTime(v: string | Date | null | undefined): string {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v) : d2(v);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function d2(x: Date) {
  return x;
}

export function formatTime(v: string | Date | null | undefined): string {
  if (!v) return '';
  const d = typeof v === 'string' ? new Date(v) : v;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
