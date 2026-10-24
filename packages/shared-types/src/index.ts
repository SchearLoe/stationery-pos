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

export type PaymentMethod = 'CASH' | 'WECHAT' | 'ALIPAY' | 'CARD' | 'OTHER' | 'BALANCE';

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: '现金',
  WECHAT: '微信',
  ALIPAY: '支付宝',
  CARD: '刷卡',
  OTHER: '其他',
  BALANCE: '储值余额',
};

/** 收银结算可选的人工支付方式（储值余额需挂会员后单独使用，不在此列表） */
export const POS_PAY_METHODS: PaymentMethod[] = ['CASH', 'WECHAT', 'ALIPAY', 'CARD', 'OTHER'];

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
  /** 挂单会员 ID：应用会员价、可余额支付/积分抵扣 */
  memberId?: string;
  /** 使用积分抵扣的数量（分/积分价值折算），可选 */
  usePoints?: number;
  remark?: string | null;
  /** 离线创建时间（毫秒时间戳），在线收银不传 */
  offlineCreatedAt?: number;
  /** 本地生成的 UUID，用于幂等去重；在线收银可不传 */
  clientId?: string;
  /** 离线单客户端单号（L 前缀），与 clientId 同时出现表示离线单 */
  clientOrderNo?: string;
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
  memberId?: string | null;
  memberName?: string | null;
  status: 'NORMAL' | 'VOID';
  items: SaleItemDto[];
  payments: PaymentDto[];
  totalAmount: number;
  discountAmount: number;
  pointsDiscount?: number;
  pointsUsed?: number;
  pointsEarned?: number;
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
  | 'IMPORT'
  | 'PURCHASE'
  | 'STOCKTAKE';

export const INVENTORY_CHANGE_LABELS: Record<InventoryChangeType, string> = {
  SALE: '销售出库',
  REFUND: '退货入库',
  INIT: '期初建账',
  ADJUST: '库存调整',
  VOID_BACK: '作废回补',
  IMPORT: '批量导入',
  PURCHASE: '采购入库',
  STOCKTAKE: '盘点调整',
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
  /** 启用小票打印（经 Windows 打印驱动）。可选功能，默认关闭 */
  receiptPrintingEnabled: boolean;
  /** 收款后自动静默打印（需先启用打印） */
  autoPrintReceipt: boolean;
  /** 启用 ESC/POS 直连打印（RAW 指令，使用打印机字库，不经过驱动排版） */
  escposDirectEnabled: boolean;
  /** ESC/POS 直连目标打印机名（本机已安装的打印机） */
  escposPrinterName: string;
  /** 小票纸宽（毫米），58 或 80 */
  receiptPaperWidth: number;
  /** 会员积分规则：每消费 1 元获得积分数（向下取整），0 = 不送积分 */
  memberPointsPerYuan: number;
  /** 会员积分规则：1 积分抵扣金额（分），默认 1 分 = 0.01 元 */
  memberPointValueCent: number;
}

// ---------- 二期：采购 / 应付 ----------

export type PurchaseStatus = 'DRAFT' | 'RECEIVED' | 'CANCELLED';

export const PURCHASE_STATUS_LABELS: Record<PurchaseStatus, string> = {
  DRAFT: '待入库',
  RECEIVED: '已入库',
  CANCELLED: '已取消',
};

export interface SupplierDto {
  id: string;
  name: string;
  phone: string | null;
  contact: string | null;
  remark: string | null;
  active: boolean;
  /** 应付余额（分）：已入库采购额 - 已付款，列表接口附带 */
  payable?: number;
  orderCount?: number;
}

export interface PurchaseItemDto {
  id: string;
  skuId: string;
  productName: string;
  spec: string | null;
  barcode: string | null;
  unit: string;
  qty: number;
  unitCost: number;
  subtotal: number;
}

export interface PurchasePaymentDto {
  id: string;
  amount: number;
  method: PaymentMethod;
  note: string | null;
  createdAt: string;
}

export interface PurchaseOrderDto {
  id: string;
  orderNo: string;
  supplierId: string;
  supplierName?: string;
  status: PurchaseStatus;
  totalAmount: number;
  paidAmount: number;
  payableAmount: number;
  remark: string | null;
  operatorName?: string | null;
  receivedAt: string | null;
  createdAt: string;
  items?: PurchaseItemDto[];
  payments?: PurchasePaymentDto[];
}

export interface CreatePurchaseInput {
  supplierId: string;
  remark?: string | null;
  items: { skuId: string; qty: number; unitCost: number }[];
}

export interface PayableSummaryDto {
  supplierId: string;
  supplierName: string;
  phone: string | null;
  /** 已入库采购总额 */
  receivedTotal: number;
  paidTotal: number;
  /** 应付余额 */
  payable: number;
  orderCount: number;
}

// ---------- 二期：盘点任务 ----------

export type StocktakeStatus = 'OPEN' | 'APPLIED' | 'CANCELLED';

export const STOCKTAKE_STATUS_LABELS: Record<StocktakeStatus, string> = {
  OPEN: '盘点中',
  APPLIED: '已应用',
  CANCELLED: '已取消',
};

export interface StocktakeItemDto {
  id: string;
  skuId: string;
  productName: string;
  spec: string | null;
  barcode?: string | null;
  unit: string;
  snapshotQty: number;
  countedQty: number | null;
  /** countedQty - snapshotQty，未盘为 null */
  diff: number | null;
}

export interface StocktakeTaskDto {
  id: string;
  taskNo: string;
  status: StocktakeStatus;
  scopeCategoryId: string | null;
  scopeCategoryName?: string | null;
  note: string | null;
  creatorName?: string | null;
  appliedAt: string | null;
  createdAt: string;
  itemCount?: number;
  countedCount?: number;
  diffCount?: number;
  items?: StocktakeItemDto[];
}

// ---------- 二期：会员储值 / 积分 ----------

export interface MemberDto {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  /** 储值余额（分） */
  balance: number;
  points: number;
  active: boolean;
  remark: string | null;
  createdAt: string;
}

export type MemberTxnType = 'RECHARGE' | 'CONSUME' | 'REFUND' | 'EARN' | 'REDEEM' | 'ADJUST';

export const MEMBER_TXN_LABELS: Record<MemberTxnType, string> = {
  RECHARGE: '充值',
  CONSUME: '消费',
  REFUND: '退款返还',
  EARN: '积分获得',
  REDEEM: '积分抵扣',
  ADJUST: '人工调整',
};

export interface MemberTxnDto {
  id: string;
  type: MemberTxnType;
  amount: number;
  balanceAfter: number;
  pointsChange: number;
  pointsAfter: number;
  refNo: string | null;
  note: string | null;
  operatorName?: string | null;
  createdAt: string;
}

// ---------- 二期：支出记账 / 月结 ----------

export type ExpenseCategory = 'RESTOCK' | 'RENT' | 'UTILITIES' | 'PAYROLL' | 'FREIGHT' | 'OTHER';

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  RESTOCK: '补货采购',
  RENT: '房租',
  UTILITIES: '水电物业',
  PAYROLL: '工资',
  FREIGHT: '运费',
  OTHER: '其他',
};

export interface ExpenseDto {
  id: string;
  date: string;
  category: ExpenseCategory;
  amount: number;
  title: string;
  note: string | null;
  operatorName?: string | null;
  createdAt: string;
}

export interface MonthlyStatementDto {
  /** 月份，YYYY-MM */
  month: string;
  /** 销售实收（NORMAL 单 payable 合计） */
  salesAmount: number;
  refundAmount: number;
  netSalesAmount: number;
  orderCount: number;
  /** 销售成本（按下单时点成本快照估算，扣除退货） */
  cogsAmount: number;
  /** 毛利 = 净销售 - 销售成本 */
  grossProfit: number;
  /** 本月入库的采购总额 / 已付款额 */
  purchaseReceivedAmount: number;
  purchasePaidAmount: number;
  /** 杂项支出（不含采购付款） */
  expenseTotal: number;
  expensesByCategory: { category: ExpenseCategory; amount: number }[];
  /** 会员充值收入（本金+赠送） */
  memberRechargeAmount: number;
  /** 净利估算 = 毛利 - 杂项支出 */
  netProfitEstimate: number;
}
