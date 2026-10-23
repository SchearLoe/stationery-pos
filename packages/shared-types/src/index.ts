/**
 * 全局共享类型：由桌面端与服务端共同引用。
 * 金额一律以「分」为单位的整数存储与传输，展示层再格式化为元，避免浮点误差。
 */

export type UserRole = 'BOSS' | 'CASHIER';

export interface AuthUser {
  id: string;
  username: string;
  name: string;
  role: UserRole;
}

export interface LoginResult {
  accessToken: string;
  user: AuthUser;
}

// ---------- 商品目录 ----------

export type ProductStatus = 'ON_SALE' | 'OFF_SALE';

export interface CategoryDto {
  id: string;
  name: string;
  parentId: string | null;
  sort: number;
}

export interface SkuDto {
  id: string;
  productId: string;
  /** 展示用主条码（第一个），完整条码列表见 barcodes */
  barcode: string | null;
  barcodes?: string[];
  spec: string | null;
  /** 零售价，分 */
  retailPrice: number;
  /** 会员价，分；空表示无会员价 */
  memberPrice: number | null;
  /** 最低售价，分；收银员改价不得低于此价。空表示不限 */
  minPrice: number | null;
  /** 安全库存，低于触发预警 */
  safetyStock: number;
  status: ProductStatus;
  /** 最近进价（仅老板可见） */
  lastCost?: number | null;
  /** 加权平均成本（仅老板可见） */
  costAvg?: number | null;
  /** 当前库存（列表接口返回） */
  qty?: number;
}

export interface ProductDto {
  id: string;
  name: string;
  brand: string | null;
  categoryId: string | null;
  categoryName?: string | null;
  unit: string;
  status: ProductStatus;
  remark: string | null;
  skus: SkuDto[];
}

export interface SkuUpsertInput {
  id?: string;
  barcode?: string | null;
  spec?: string | null;
  retailPrice: number;
  memberPrice?: number | null;
  minPrice?: number | null;
  /** 最近进价（分），仅老板维护 */
  cost?: number | null;
  safetyStock?: number;
  status?: ProductStatus;
  /** 期初库存，仅新建时生效 */
  initQty?: number;
}

export interface ProductUpsertInput {
  id?: string;
  name: string;
  brand?: string | null;
  categoryId?: string | null;
  unit: string;
  status?: ProductStatus;
  remark?: string | null;
  skus: SkuUpsertInput[];
}

// ---------- 收银 ----------

export type PaymentMethod = 'CASH' | 'WECHAT' | 'ALIPAY' | 'CARD' | 'OTHER';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: '现金',
  WECHAT: '微信',
  ALIPAY: '支付宝',
  CARD: '刷卡',
  OTHER: '其他',
};

export interface SaleItemInput {
  skuId: string;
  qty: number;
  /** 成交单价（分）。与零售价不同即为改价 */
  unitPrice: number;
}

export interface PaymentInput {
  method: PaymentMethod;
  /** 支付金额（分） */
  amount: number;
}

export interface CreateSaleOrderInput {
  items: SaleItemInput[];
  payments: PaymentInput[];
  /** 整单折扣金额（分），可选 */
  discountAmount?: number;
  remark?: string | null;
  /** 离线创建时间（毫秒时间戳），在线收银不传 */
  offlineCreatedAt?: number;
  /** 本地生成的 UUID，用于幂等去重；在线收银可不传 */
  clientId?: string;
}

export interface SaleItemDto {
  id: string;
  skuId: string;
  productName: string;
  spec: string | null;
  barcode: string | null;
  unit: string;
  qty: number;
  /** 成交单价，分 */
  unitPrice: number;
  subtotal: number;
  refundedQty: number;
}

export interface PaymentDto {
  id: string;
  method: PaymentMethod;
  amount: number;
}

export interface SaleOrderDto {
  id: string;
  orderNo: string;
  shiftId: string | null;
  cashierId: string;
  cashierName?: string;
  status: 'NORMAL' | 'VOID';
  items: SaleItemDto[];
  payments: PaymentDto[];
  totalAmount: number;
  discountAmount: number;
  payableAmount: number;
  remark: string | null;
  voidReason: string | null;
  createdAt: string;
}

// ---------- 退货 ----------

export interface CreateRefundInput {
  orderId: string;
  reason: string;
  /** saleItemId -> 退货数量 */
  items: { saleItemId: string; qty: number }[];
  /** 退款方式，默认原路（现金则现金） */
  method?: PaymentMethod;
}

export interface RefundOrderDto {
  id: string;
  refundNo: string;
  orderId: string;
  orderNo: string;
  cashierName?: string;
  amount: number;
  reason: string;
  method: PaymentMethod;
  items: {
    id: string;
    saleItemId: string;
    productName: string;
    spec: string | null;
    qty: number;
    unitPrice: number;
    subtotal: number;
  }[];
  createdAt: string;
}

// ---------- 交接班 ----------

export interface ShiftDto {
  id: string;
  cashierId: string;
  cashierName?: string;
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  orderCount?: number;
  /** 应收现金（分），关闭时统计 */
  expectedCash?: number;
  countedCash?: number | null;
  diff?: number | null;
  /** 各支付方式汇总（关闭时统计），分 */
  summary?: { method: PaymentMethod; amount: number; count: number }[];
  totalAmount?: number;
}

// ---------- 报表（一期简版） ----------

export interface SalesSummaryDto {
  /** 统计起始时间 */
  from: string;
  to: string;
  orderCount: number;
  refundCount: number;
  salesAmount: number;
  refundAmount: number;
  netAmount: number;
  byMethod: { method: PaymentMethod; amount: number; count: number }[];
}

export interface TopProductDto {
  skuId: string;
  productName: string;
  spec: string | null;
  qty: number;
  amount: number;
}

// ---------- 库存 ----------

export type InventoryChangeType =
  | 'SALE'
  | 'REFUND'
  | 'INIT'
  | 'ADJUST'
  | 'VOID_BACK'
  | 'IMPORT';

export const INVENTORY_CHANGE_LABELS: Record<InventoryChangeType, string> = {
  SALE: '销售出库',
  REFUND: '退货入库',
  INIT: '期初建账',
  ADJUST: '库存调整',
  VOID_BACK: '作废回补',
  IMPORT: '批量导入',
};

export interface InventoryLogDto {
  id: string;
  skuId: string;
  productName?: string;
  spec?: string | null;
  barcode?: string | null;
  type: InventoryChangeType;
  change: number;
  after: number;
  refNo: string | null;
  note: string | null;
  operatorName?: string;
  createdAt: string;
}

export interface AdjustInventoryInput {
  skuId: string;
  /** 调整后的实际库存数量（按差异生成调整流水） */
  actualQty: number;
  note?: string;
}

// ---------- 系统设置 ----------

export interface StoreSettings {
  storeName: string;
  storePhone: string;
  storeAddress: string;
  receiptFooter: string;
  /** 是否允许负库存销售 */
  allowNegativeStock: boolean;
  /** 收银员整单折扣下限（百分比，95 = 最低95折） */
  cashierMinDiscountPercent: number;
  /** 是否允许收银员执行退货 */
  cashierCanRefund: boolean;
}
