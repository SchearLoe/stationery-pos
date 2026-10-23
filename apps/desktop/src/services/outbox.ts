/**
 * 离线销售 outbox 队列（IndexedDB）：
 * 断网期间的销售单先入队，联网后按 FIFO 顺序同步上云。
 * 记录同时保存「小票展示对象」（本地生成的 SaleOrderDto 形状），供离线时打印与展示。
 */
import { get, set } from 'idb-keyval';
import type { CreateSaleOrderInput, SaleOrderDto } from '@pos/shared-types';

const KEY = 'pos_outbox_v1';

export type OutboxStatus = 'PENDING' | 'FAILED';

export interface OutboxSale {
  clientId: string;
  clientOrderNo: string;
  createdAt: number;
  offlineCreatedAt: string;
  /** 补传给服务端的创建参数（含 clientId/clientOrderNo/offlineCreatedAt） */
  payload: CreateSaleOrderInput;
  /** 本地小票/列表展示用 */
  receipt: SaleOrderDto;
  status: OutboxStatus;
  failedReason?: string;
  attempts: number;
}

export async function listOutbox(): Promise<OutboxSale[]> {
  return (await get<OutboxSale[]>(KEY)) ?? [];
}

export async function enqueueSale(sale: OutboxSale): Promise<void> {
  const list = await listOutbox();
  list.push(sale);
  await set(KEY, list);
}

export async function removeFromOutbox(clientId: string): Promise<void> {
  const list = await listOutbox();
  await set(
    KEY,
    list.filter((s) => s.clientId !== clientId),
  );
}

export async function patchOutboxSale(
  clientId: string,
  patch: Partial<Pick<OutboxSale, 'status' | 'failedReason' | 'attempts'>>,
): Promise<void> {
  const list = await listOutbox();
  const item = list.find((s) => s.clientId === clientId);
  if (!item) return;
  Object.assign(item, patch);
  await set(KEY, list);
}

/** 生成本地离线单号：L + yyyyMMdd + 4 位随机段（防撞号，非安全用途） */
export function genClientOrderNo(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(2)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return `L${ymd}-${rand}`;
}

export function isNetworkError(e: unknown): boolean {
  if (e && typeof e === 'object') {
    const err = e as { response?: unknown; code?: string; message?: string };
    // axios：无 response = 网络层失败（断网/超时/DNS）
    return !err.response && (err.code === 'ECONNABORTED' || err.code === 'ERR_NETWORK' || err.message?.includes('Network Error') === true);
  }
  return false;
}
