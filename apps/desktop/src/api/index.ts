import { http } from './client';

export { setApiBaseUrl, getApiBaseUrl } from './client';
import type {
  AdjustInventoryInput,
  AuthUser,
  CategoryDto,
  CreateRefundInput,
  CreateSaleOrderInput,
  LoginResult,
  ProductDto,
  ProductUpsertInput,
  SaleOrderDto,
  SalesSummaryDto,
  ShiftDto,
  StoreSettings,
  TopProductDto,
} from '@pos/shared-types';

// ---------- 认证 ----------
export const login = (username: string, password: string) =>
  http.post<never, LoginResult>('/auth/login', { username, password });

export const bossLogin = login; // 授权弹窗复用同一接口校验老板身份

export const changePassword = (oldPassword: string, newPassword: string) =>
  http.post<never, { ok: boolean }>('/auth/change-password', { oldPassword, newPassword });

// ---------- 分类 / 商品 ----------
export const listCategories = () => http.get<never, CategoryDto[]>('/categories');

export const createCategory = (data: { name: string; parentId?: string; sort?: number }) =>
  http.post<never, CategoryDto>('/categories', data);

export const updateCategory = (id: string, data: { name: string; sort?: number }) =>
  http.put<never, CategoryDto>(`/categories/${id}`, data);

export const deleteCategory = (id: string) => http.delete<never, { ok: boolean }>(`/categories/${id}`);

export interface ProductListQuery {
  keyword?: string;
  categoryId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export const listProducts = (q: ProductListQuery) =>
  http.get<never, { total: number; items: ProductDto[] }>('/products', { params: q });

export const findByBarcode = (barcode: string) =>
  http.get<never, { sku: ProductDto['skus'][number]; productName: string; unit: string; productStatus: string } | null>(
    `/products/barcode/${encodeURIComponent(barcode)}`,
  );

export const createProduct = (data: ProductUpsertInput) => http.post<never, { id: string }>('/products', data);

export const updateProduct = (id: string, data: ProductUpsertInput) =>
  http.put<never, { id: string }>(`/products/${id}`, data);

export const importProducts = (rows: unknown[], autoBarcode = true) =>
  http.post<never, { createdProducts: number; createdSkus: number; skipped: number; errors: { row: number; message: string }[] }>(
    '/products/import',
    { rows, autoBarcode },
  );

// ---------- 销售 ----------
export const createSaleOrder = (data: CreateSaleOrderInput) =>
  http.post<never, SaleOrderDto>('/sales/orders', data);

export const listOrders = (q: Record<string, unknown>) =>
  http.get<never, { total: number; items: SaleOrderDto[] }>('/sales/orders', { params: q });

export const getOrderByNo = (orderNo: string) =>
  http.get<never, SaleOrderDto>(`/sales/orders/by-no/${encodeURIComponent(orderNo)}`);

export const voidOrder = (id: string, reason: string) =>
  http.put<never, SaleOrderDto>(`/sales/orders/${id}/void`, { reason });

export const createRefund = (data: CreateRefundInput) => http.post<never, unknown>('/sales/refunds', data);

export const listRefunds = (q: Record<string, unknown>) =>
  http.get<never, { total: number; items: unknown[] }>('/sales/refunds', { params: q });

// ---------- 班次 ----------
export const currentShift = () => http.get<never, (ShiftDto & { total?: number; orderCount?: number; refundAmount?: number; summary?: { method: string; amount: number; count: number }[] }) | null>('/shifts/current');

export const openShift = () => http.post<never, unknown>('/shifts/open');

export const closeShift = (countedCash: number, note?: string) =>
  http.post<never, unknown>('/shifts/close', { countedCash, note });

export const listShifts = (q: Record<string, unknown>) =>
  http.get<never, { total: number; items: ShiftDto[] }>('/shifts', { params: q });

// ---------- 库存 ----------
// 列表行结构动态（随角色增减字段），此处用 any 便于模板直接渲染
export const listInventory = (q: Record<string, unknown>) =>
  http.get<never, { total: number; items: any[] }>('/inventory', { params: q });

export const listInventoryLogs = (q: Record<string, unknown>) =>
  http.get<never, { total: number; items: any[] }>('/inventory/logs', { params: q });

export const adjustInventory = (data: AdjustInventoryInput) =>
  http.post<never, { ok: boolean }>('/inventory/adjust', data);

// ---------- 报表 ----------
export const reportSummary = (from: string, to: string) =>
  http.get<never, SalesSummaryDto>('/reports/summary', { params: { from, to } });

export const reportTopProducts = (from: string, to: string, limit = 20) =>
  http.get<never, TopProductDto[]>('/reports/top-products', { params: { from, to, limit } });

export const reportDaily = (from: string, to: string) =>
  http.get<never, { date: string; sales: number; refunds: number; orders: number; net: number }[]>(
    '/reports/daily',
    { params: { from, to } },
  );

export const reportStockValue = () =>
  http.get<never, { skuCount: number; totalQty: number; totalValue: number; lowStockSkuCount: number }>(
    '/reports/stock-value',
  );

// ---------- 用户 / 设置 ----------
export const listUsers = () => http.get<never, (AuthUser & { active: boolean; createdAt: string })[]>('/users');

export const createUser = (data: { username: string; password: string; name?: string; role?: string }) =>
  http.post<never, unknown>('/users', data);

export const updateUser = (id: string, data: Record<string, unknown>) => http.put<never, unknown>(`/users/${id}`, data);

export const getSettings = () => http.get<never, StoreSettings>('/settings');

export const updateSettings = (patch: Partial<StoreSettings>) => http.put<never, StoreSettings>('/settings', patch);

export const listAuditLogs = (q: Record<string, unknown>) =>
  http.get<never, { total: number; items: any[] }>('/settings/audit-logs', { params: q });
