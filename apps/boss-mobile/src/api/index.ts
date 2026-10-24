import { http } from './request';

/** 金额工具：接口金额一律为「分」，展示转「元」 */
export const fenToYuan = (fen: number | null | undefined): string =>
  fen === null || fen === undefined ? '' : (fen / 100).toFixed(2);
export const yuanToFen = (v: string | number): number => Math.round(Number(v) * 100 || 0);
export const money = (fen: number | null | undefined): string => `¥${fenToYuan(fen)}`;

export function isoDay(d: Date): string {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString();
}
export function todayStart(): string {
  return isoDay(new Date());
}
export function daysAgoStart(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
}
export function todayEnd(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59).toISOString();
}

const qs = (params: Record<string, string | number | undefined>): string => {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
};

// ---------- 认证 ----------
export interface LoginResult {
  accessToken: string;
  user: { id: string; name: string; role: string };
}
export const login = (username: string, password: string) =>
  http<LoginResult>('POST', '/auth/login', { username, password });

// ---------- 报表（远程看店） ----------
export interface SummaryDto {
  orderCount: number;
  refundCount: number;
  salesAmount: number;
  refundAmount: number;
  netAmount: number;
  byMethod: { method: string; amount: number; count: number }[];
}
export const reportSummary = (from: string, to: string) =>
  http<SummaryDto>('GET', `/reports/summary${qs({ from, to })}`);

export interface DailyDto {
  date: string;
  sales: number;
  refunds: number;
  orders: number;
  net: number;
}
export const reportDaily = (from: string, to: string) =>
  http<DailyDto[]>('GET', `/reports/daily${qs({ from, to })}`);

export interface StockValueDto {
  skuCount: number;
  totalQty: number;
  totalValue: number;
  lowStockSkuCount: number;
}
export const reportStockValue = () => http<StockValueDto>('GET', '/reports/stock-value');

// ---------- 采购 / 应付 ----------
export interface PurchaseOrderDto {
  id: string;
  orderNo: string;
  supplierName?: string;
  status: 'DRAFT' | 'RECEIVED' | 'CANCELLED';
  totalAmount: number;
  paidAmount: number;
  payableAmount: number;
  receivedAt: string | null;
  createdAt: string;
  itemCount?: number;
}
export const listPurchaseOrders = (q: { status?: string; page?: number; pageSize?: number }) =>
  http<{ total: number; items: PurchaseOrderDto[] }>('GET', `/purchases/orders${qs(q)}`);

export const receivePurchase = (id: string) =>
  http<PurchaseOrderDto>('POST', `/purchases/orders/${id}/receive`);

export const cancelPurchase = (id: string) =>
  http<PurchaseOrderDto>('POST', `/purchases/orders/${id}/cancel`);

export const payPurchase = (id: string, data: { amount: number; method?: string; note?: string }) =>
  http<PurchaseOrderDto>('POST', `/purchases/orders/${id}/payments`, data);

export interface PayableSummaryDto {
  supplierId: string;
  supplierName: string;
  phone: string | null;
  receivedTotal: number;
  paidTotal: number;
  payable: number;
  orderCount: number;
}
export const purchasePayables = () => http<PayableSummaryDto[]>('GET', '/purchases/payables');

// ---------- 盘点 ----------
export interface StocktakeTaskDto {
  id: string;
  taskNo: string;
  status: 'OPEN' | 'APPLIED' | 'CANCELLED';
  scopeCategoryName?: string | null;
  note: string | null;
  appliedAt: string | null;
  createdAt: string;
  itemCount?: number;
  countedCount?: number;
  diffCount?: number;
  items?: StocktakeItemDto[];
}
export interface StocktakeItemDto {
  id: string;
  skuId: string;
  productName: string;
  spec: string | null;
  barcode?: string | null;
  unit: string;
  snapshotQty: number;
  countedQty: number | null;
  diff: number | null;
}
export const listStocktakes = (q: { status?: string; page?: number; pageSize?: number }) =>
  http<{ total: number; items: StocktakeTaskDto[] }>('GET', `/stocktakes${qs(q)}`);

export const getStocktake = (id: string) => http<StocktakeTaskDto>('GET', `/stocktakes/${id}`);

export const createStocktake = (data: { categoryId?: string; note?: string }) =>
  http<StocktakeTaskDto>('POST', '/stocktakes', data);

export const saveStocktakeCounts = (id: string, items: { id: string; countedQty: number | null }[]) =>
  http<StocktakeTaskDto>('PUT', `/stocktakes/${id}/counts`, { items });

export const applyStocktake = (id: string) =>
  http<StocktakeTaskDto>('POST', `/stocktakes/${id}/apply`);

export const cancelStocktake = (id: string) =>
  http<StocktakeTaskDto>('POST', `/stocktakes/${id}/cancel`);

// ---------- 会员 ----------
export interface MemberDto {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  balance: number;
  points: number;
  active: boolean;
}
export const listMembers = (q: { keyword?: string; page?: number; pageSize?: number }) =>
  http<{ total: number; items: MemberDto[] }>('GET', `/members${qs(q)}`);

export const rechargeMember = (
  id: string,
  data: { amount: number; bonus?: number; method?: string; note?: string },
) => http<MemberDto>('POST', `/members/${id}/recharge`, data);
