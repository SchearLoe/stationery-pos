import { http } from './client';

export { setApiBaseUrl, getApiBaseUrl } from './client';
import type {
  AdjustInventoryInput,
  AuthUser,
  CategoryDto,
  CreatePurchaseInput,
  CreateRefundInput,
  CreateSaleOrderInput,
  ExpenseDto,
  LoginResult,
  MemberDto,
  MemberTxnDto,
  MonthlyStatementDto,
  PayableSummaryDto,
  ProductDto,
  ProductUpsertInput,
  PurchaseOrderDto,
  SaleOrderDto,
  SalesSummaryDto,
  ShiftDto,
  StocktakeTaskDto,
  StoreSettings,
  SupplierDto,
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

// ---------- 采购 / 应付（二期） ----------

export const listSuppliers = (keyword?: string) =>
  http.get<never, (SupplierDto & { receivedTotal: number; paidTotal: number; payable: number; orderCount: number })[]>(
    '/purchases/suppliers',
    { params: keyword ? { keyword } : undefined },
  );

export const createSupplier = (data: { name: string; phone?: string | null; contact?: string | null; remark?: string | null }) =>
  http.post<never, SupplierDto>('/purchases/suppliers', data);

export const updateSupplier = (id: string, data: { name: string; phone?: string | null; contact?: string | null; remark?: string | null }) =>
  http.put<never, SupplierDto>(`/purchases/suppliers/${id}`, data);

export const deleteSupplier = (id: string) =>
  http.delete<never, { ok: boolean; disabled: boolean }>(`/purchases/suppliers/${id}`);

export const listPurchaseOrders = (q: Record<string, unknown>) =>
  http.get<never, { total: number; items: PurchaseOrderDto[] }>('/purchases/orders', { params: q });

export const getPurchaseOrder = (id: string) =>
  http.get<never, PurchaseOrderDto>(`/purchases/orders/${id}`);

export const createPurchase = (data: CreatePurchaseInput) =>
  http.post<never, PurchaseOrderDto>('/purchases/orders', data);

export const receivePurchase = (id: string) =>
  http.post<never, PurchaseOrderDto>(`/purchases/orders/${id}/receive`);

export const cancelPurchase = (id: string) =>
  http.post<never, PurchaseOrderDto>(`/purchases/orders/${id}/cancel`);

export const payPurchase = (
  id: string,
  data: { amount: number; method?: 'CASH' | 'WECHAT' | 'ALIPAY' | 'CARD' | 'OTHER'; note?: string },
) => http.post<never, PurchaseOrderDto>(`/purchases/orders/${id}/payments`, data);

export const purchasePayables = () =>
  http.get<never, PayableSummaryDto[]>('/purchases/payables');

// ---------- 盘点任务（二期） ----------

export const listStocktakes = (q: Record<string, unknown>) =>
  http.get<never, { total: number; items: StocktakeTaskDto[] }>('/stocktakes', { params: q });

export const getStocktake = (id: string) =>
  http.get<never, StocktakeTaskDto>(`/stocktakes/${id}`);

export const createStocktake = (data: { categoryId?: string; note?: string }) =>
  http.post<never, StocktakeTaskDto>('/stocktakes', data);

export const saveStocktakeCounts = (
  id: string,
  items: { id: string; countedQty: number | null }[],
) => http.put<never, StocktakeTaskDto>(`/stocktakes/${id}/counts`, { items });

export const applyStocktake = (id: string) =>
  http.post<never, StocktakeTaskDto>(`/stocktakes/${id}/apply`);

export const cancelStocktake = (id: string) =>
  http.post<never, StocktakeTaskDto>(`/stocktakes/${id}/cancel`);

// ---------- 会员储值 / 积分（二期） ----------

export const listMembers = (q: Record<string, unknown>) =>
  http.get<never, { total: number; items: MemberDto[] }>('/members', { params: q });

export const lookupMember = (key: string) =>
  http.get<never, MemberDto>('/members/lookup', { params: { key } });

export const createMember = (data: { name: string; phone?: string | null; remark?: string | null }) =>
  http.post<never, MemberDto>('/members', data);

export const updateMember = (id: string, data: Record<string, unknown>) =>
  http.put<never, MemberDto>(`/members/${id}`, data);

export const rechargeMember = (
  id: string,
  data: { amount: number; bonus?: number; method?: 'CASH' | 'WECHAT' | 'ALIPAY' | 'CARD' | 'OTHER'; note?: string },
) => http.post<never, MemberDto>(`/members/${id}/recharge`, data);

export const adjustMember = (
  id: string,
  data: { balanceDelta?: number; pointsDelta?: number; note: string },
) => http.post<never, MemberDto>(`/members/${id}/adjust`, data);

export const memberTxns = (id: string, q: Record<string, unknown>) =>
  http.get<never, { total: number; items: MemberTxnDto[] }>(`/members/${id}/txns`, { params: q });

// ---------- 账目 / 月结（二期） ----------

export const listExpenses = (q: Record<string, unknown>) =>
  http.get<never, { total: number; totalAmount: number; items: ExpenseDto[] }>('/ledger/expenses', { params: q });

export const createExpense = (data: { date: string; category: string; amount: number; title: string; note?: string | null }) =>
  http.post<never, ExpenseDto>('/ledger/expenses', data);

export const updateExpense = (id: string, data: Record<string, unknown>) =>
  http.put<never, ExpenseDto>(`/ledger/expenses/${id}`, data);

export const deleteExpense = (id: string) =>
  http.delete<never, { ok: boolean }>(`/ledger/expenses/${id}`);

export const monthlyStatement = (month: string) =>
  http.get<never, MonthlyStatementDto>('/ledger/monthly', { params: { month } });

// ---------- 报表导出（二期，CSV 带中文表头，可直接用 Excel 打开） ----------

async function downloadCsv(path: string, params: Record<string, unknown> | undefined, filename: string) {
  const blob = await http.get<never, Blob>(path, { params, responseType: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export const exportSummaryCsv = (from: string, to: string) =>
  downloadCsv('/reports/export/summary', { from, to }, `销售汇总_${from}_${to}.csv`);

export const exportDailyCsv = (from: string, to: string) =>
  downloadCsv('/reports/export/daily', { from, to }, `每日销售_${from}_${to}.csv`);

export const exportTopProductsCsv = (from: string, to: string) =>
  downloadCsv('/reports/export/top-products', { from, to, limit: 50 }, `商品销量_${from}_${to}.csv`);

export const exportOrdersCsv = (from: string, to: string) =>
  downloadCsv('/reports/export/orders', { from, to }, `销售明细_${from}_${to}.csv`);

export const exportInventoryCsv = () =>
  downloadCsv('/reports/export/inventory', undefined, `库存快照_${new Date().toISOString().slice(0, 10)}.csv`);

export const exportMonthlyCsv = (month: string) =>
  downloadCsv('/reports/export/monthly', { month }, `月结报表_${month}.csv`);
