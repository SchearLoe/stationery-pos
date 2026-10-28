<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Delete, Plus, Minus, Tickets, CreditCard, Avatar } from '@element-plus/icons-vue';
import type { MemberDto, PaymentMethod, SaleOrderDto } from '@pos/shared-types';
import { PAYMENT_METHOD_LABELS, POS_PAY_METHODS } from '@pos/shared-types';
import { findByBarcode, listProducts, createSaleOrder, currentShift, lookupMember } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useCartStore } from '@/stores/cart';
import { useSettingsStore } from '@/stores/settings';
import { useSyncStore } from '@/stores/sync';
import { cachedFindByBarcode, cachedSearch, applySaleToCache } from '@/services/catalog-cache';
import { enqueueSale, genClientOrderNo, isNetworkError } from '@/services/outbox';
import { printReceipt } from '@/services/print';
import { fenToYuan, yuanToFen, money, formatTime } from '@/utils/money';
import BossAuthDialog from '@/components/BossAuthDialog.vue';
import ReceiptView from '@/components/ReceiptView.vue';

const auth = useAuthStore();
const cart = useCartStore();
const settings = useSettingsStore();
const sync = useSyncStore();
const router = useRouter();

const barcodeInput = ref('');
const inputRef = ref<{ focus: () => void } | null>(null);
const submitting = ref(false);

// 搜索选择
const searchVisible = ref(false);
const searchKeyword = ref('');
const searchResults = ref<Awaited<ReturnType<typeof listProducts>>['items']>([]);

// 改价
const priceDialog = ref(false);
const priceEditTarget = ref<{ skuId: string; name: string; current: number; minPrice: number | null } | null>(null);
const priceNewValue = ref('');
const authVisible = ref(false);
let pendingAction: (() => void) | null = null;

// 整单折扣
const discountVisible = ref(false);
const discountValue = ref('');

// 结算
const payVisible = ref(false);
const payLines = ref<{ method: PaymentMethod; amount: string }[]>([]);
const lastOrder = ref<SaleOrderDto | null>(null);
const lastOrderOffline = ref(false);
const receiptVisible = ref(false);
const receiptRef = ref<InstanceType<typeof ReceiptView> | null>(null);

// ---------- 会员（挂单会员价 / 储值支付 / 积分抵扣） ----------

const member = ref<MemberDto | null>(null);
const memberVisible = ref(false);
const memberKey = ref('');
const memberLoading = ref(false);
/** 本单使用的积分数量（结算弹窗内输入） */
const pointsInput = ref('');

const pointValueCent = computed(() => settings.settings.memberPointValueCent || 1);
const pointsUsed = computed(() => Math.max(0, Math.floor(Number(pointsInput.value) || 0)));
/** 积分可抵扣上限：会员积分与订单金额取小 */
const maxPoints = computed(() => {
  if (!member.value) return 0;
  const byBalance = member.value.points;
  const byAmount = Math.floor(cart.payable / pointValueCent.value);
  return Math.max(0, Math.min(byBalance, byAmount));
});
const pointsDiscount = computed(() => Math.min(pointsUsed.value * pointValueCent.value, cart.payable));
/** 积分抵扣后的应收金额 */
const payableFinal = computed(() => Math.max(0, cart.payable - pointsDiscount.value));

async function confirmAttachMember() {
  const key = memberKey.value.trim();
  if (!key) return;
  memberLoading.value = true;
  try {
    member.value = await lookupMember(key);
    memberVisible.value = false;
    memberKey.value = '';
    applyMemberPrice();
    ElMessage.success(`已挂会员「${member.value.name}」，会员价已应用`);
  } catch {
    // 拦截器已提示（未找到该会员）
  } finally {
    memberLoading.value = false;
  }
}

function detachMember() {
  // 解除挂单：只恢复「由挂会员自动改写为会员价」的行，手工改价/授权价不受影响
  for (const it of cart.items) {
    if (it.memberApplied) {
      cart.setPrice(it.skuId, it.retailPrice);
      it.memberApplied = false;
    }
  }
  member.value = null;
  pointsInput.value = '';
}

/** 挂会员后把有会员价的行重置为会员价（收银员无最低售价限制，服务端按会员价放行） */
function applyMemberPrice() {
  for (const it of cart.items) {
    if (it.memberPrice != null && it.unitPrice !== it.memberPrice) {
      cart.setPrice(it.skuId, it.memberPrice);
      it.memberApplied = true;
    }
  }
}

async function refreshMember() {
  if (!member.value) return;
  try {
    member.value = await lookupMember(member.value.code);
  } catch {
    member.value = null;
  }
}

const cashLine = computed(() => payLines.value.find((l) => l.method === 'CASH'));
const canPrint = computed(
  () =>
    settings.settings.receiptPrintingEnabled ||
    (settings.settings.escposDirectEnabled && !!settings.settings.escposPrinterName),
);
const nonCashSum = computed(() =>
  payLines.value.filter((l) => l.method !== 'CASH').reduce((s, l) => s + yuanToFen(l.amount), 0),
);
const cashRemaining = computed(() => Math.max(0, payableFinal.value - nonCashSum.value));
const cashChange = computed(() => {
  const paid = yuanToFen(cashLine.value?.amount ?? '0');
  return Math.max(0, paid - cashRemaining.value);
});
const paySumValid = computed(() => {
  const cashPaid = Math.min(yuanToFen(cashLine.value?.amount ?? '0'), cashRemaining.value);
  return nonCashSum.value + cashPaid === payableFinal.value;
});
const balanceLine = computed(() => payLines.value.find((l) => l.method === 'BALANCE'));
const balancePaidFen = computed(() =>
  payLines.value.filter((l) => l.method === 'BALANCE').reduce((s, l) => s + yuanToFen(l.amount), 0),
);

function refocus() {
  void nextTick(() => inputRef.value?.focus());
}

onMounted(() => {
  void settings.load();
  refocus();
});

// ---------- 扫码 / 搜索（离线自动回退本地缓存） ----------

async function handleInput() {
  const code = barcodeInput.value.trim();
  if (!code) return;
  barcodeInput.value = '';
  if (/^\d{6,20}$/.test(code)) {
    await addByBarcode(code);
  } else {
    await search(code);
  }
  refocus();
}

function offlineHit(hit: Awaited<ReturnType<typeof cachedFindByBarcode>>, code: string): boolean {
  if (!hit || hit.productStatus !== 'ON_SALE' || hit.sku.status !== 'ON_SALE') {
    ElMessage.warning(`未找到在售商品：${code}`);
    return false;
  }
  addToCart({
    skuId: hit.sku.id,
    productName: hit.productName,
    spec: hit.sku.spec,
    barcode: hit.sku.barcode,
    unit: hit.unit,
    unitPrice: hit.sku.retailPrice,
    retailPrice: hit.sku.retailPrice,
    memberPrice: hit.sku.memberPrice ?? null,
    minPrice: hit.sku.minPrice,
    stockQty: hit.sku.qty ?? 0,
  });
  return true;
}

async function addByBarcode(code: string) {
  try {
    const hit = await findByBarcode(code);
    if (!hit) {
      // 在线但未命中：再查一次本地缓存（可能缓存尚未过期但服务端已停售等边缘情况）
      ElMessage.warning(`未找到在售商品：${code}`);
      return;
    }
    addToCart({
      skuId: hit.sku.id,
      productName: hit.productName,
      spec: hit.sku.spec,
      barcode: hit.sku.barcode,
      unit: hit.unit,
      unitPrice: hit.sku.retailPrice,
      retailPrice: hit.sku.retailPrice,
      memberPrice: hit.sku.memberPrice ?? null,
      minPrice: hit.sku.minPrice,
      stockQty: hit.sku.qty ?? 0,
    });
  } catch (e) {
    if (!isNetworkError(e)) return; // 业务错误由拦截器提示
    const cached = await cachedFindByBarcode(code);
    if (offlineHit(cached, code)) {
      ElMessage.info('离线模式：已从本地缓存取价');
    }
  }
}

async function search(keyword: string) {
  searchKeyword.value = keyword;
  let result: Awaited<ReturnType<typeof listProducts>>;
  try {
    result = await listProducts({ keyword, pageSize: 20 });
  } catch (e) {
    if (!isNetworkError(e)) return;
    result = { total: 0, items: await cachedSearch(keyword) };
    if (result.items.length === 0) {
      ElMessage.info(`离线模式下没有匹配「${keyword}」的商品缓存`);
      return;
    }
    ElMessage.info('离线模式：结果来自本地缓存');
  }
  if (result.items.length === 0) {
    ElMessage.info(`没有匹配「${keyword}」的商品`);
    return;
  }
  if (result.items.length === 1 && result.items[0]!.skus.length === 1) {
    const p = result.items[0]!;
    const sku = p.skus[0]!;
    addToCart({
      skuId: sku.id,
      productName: p.name,
      spec: sku.spec,
      barcode: sku.barcode,
      unit: p.unit,
      unitPrice: member.value && sku.memberPrice != null ? sku.memberPrice : sku.retailPrice,
      retailPrice: sku.retailPrice,
      memberPrice: sku.memberPrice ?? null,
      minPrice: sku.minPrice,
      stockQty: sku.qty ?? 0,
    });
    return;
  }
  searchResults.value = result.items;
  searchVisible.value = true;
}

function addToCart(item: {
  skuId: string;
  productName: string;
  spec: string | null;
  barcode: string | null;
  unit: string;
  unitPrice: number;
  retailPrice: number;
  memberPrice?: number | null;
  minPrice: number | null;
  stockQty: number;
}) {
  cart.add(item);
}

function pickProduct(p: (typeof searchResults.value)[number], sku: (typeof p.skus)[number]) {
  cart.add({
    skuId: sku.id,
    productName: p.name,
    spec: sku.spec,
    barcode: sku.barcode,
    unit: p.unit,
    unitPrice: member.value && sku.memberPrice != null ? sku.memberPrice : sku.retailPrice,
    retailPrice: sku.retailPrice,
    memberPrice: sku.memberPrice ?? null,
    minPrice: sku.minPrice,
    stockQty: sku.qty ?? 0,
  });
}

function specList(p: (typeof searchResults.value)[number]): string {
  return p.skus.map((s) => s.spec).join(' / ');
}

// ---------- 改价 / 折扣（含老板授权） ----------

function openPriceEdit(row: cartCartRow) {
  priceEditTarget.value = {
    skuId: row.skuId,
    name: row.productName + (row.spec ? ` ${row.spec}` : ''),
    current: row.unitPrice,
    minPrice: row.minPrice,
  };
  priceNewValue.value = fenToYuan(row.unitPrice);
  priceDialog.value = true;
}

type cartCartRow = ReturnType<typeof useCartStore>['items'][number];

function confirmPriceEdit() {
  const target = priceEditTarget.value;
  if (!target) return;
  const fen = yuanToFen(priceNewValue.value);
  if (fen <= 0) {
    ElMessage.warning('价格不合法');
    return;
  }
  const apply = () => {
    cart.setPrice(target.skuId, fen);
    // 人工改价后该行不再视为「会员价自动应用」，解除挂会员时不回退
    const item = cart.items.find((i) => i.skuId === target.skuId);
    if (item) item.memberApplied = false;
    priceDialog.value = false;
    refocus();
  };
  if (auth.isBoss || target.minPrice === null || fen >= target.minPrice) {
    apply();
  } else {
    // 低于最低售价：需要老板授权
    pendingAction = apply;
    authVisible.value = true;
  }
}

function onGranted() {
  pendingAction?.();
  pendingAction = null;
}

function openDiscount() {
  if (cart.isEmpty) return;
  discountValue.value = fenToYuan(cart.discountAmount);
  discountVisible.value = true;
}

function confirmDiscount() {
  const fen = yuanToFen(discountValue.value);
  if (fen < 0 || fen > cart.total) {
    ElMessage.warning('折扣金额不合法');
    return;
  }
  const apply = () => {
    cart.discountAmount = fen;
    discountVisible.value = false;
    refocus();
  };
  if (auth.isBoss) {
    apply();
    return;
  }
  const minPercent = settings.settings.cashierMinDiscountPercent;
  const payPercent = Math.floor(((cart.total - fen) / cart.total) * 100);
  if (payPercent >= minPercent) {
    apply();
  } else {
    pendingAction = apply;
    authVisible.value = true;
  }
}

// ---------- 挂单 ----------

const holdsVisible = ref(false);

function doHold() {
  if (cart.hold()) {
    ElMessage.success(`已挂单（共 ${cart.holds.length} 单）`);
    holdsVisible.value = false;
    refocus();
  }
}

function doRecall(index: number) {
  cart.recall(index);
  holdsVisible.value = false;
  refocus();
}

function removeHold(index: number) {
  cart.holds.splice(index, 1);
}

// ---------- 结算 ----------

async function openPay() {
  if (cart.isEmpty) return;
  // 校验班次（网络不可用时放行，由离线结算路径处理）
  try {
    const shift = await currentShift();
    if (!shift) {
      await ElMessageBox.confirm('当前没有进行中的班次，请先开始班次。现在去开始班次吗？', '未开班', {
        confirmButtonText: '去开班',
        cancelButtonText: '取消',
      });
      void router.push('/shift');
      return;
    }
  } catch (e) {
    if (!isNetworkError(e)) return;
    if (member.value) {
      ElMessage.warning('当前离线：会员单（会员价/储值/积分）需联网结算');
      return;
    }
    ElMessage.warning('当前离线：本单将作为离线单暂存，恢复网络后自动同步');
  }
  pointsInput.value = '';
  initPayLines();
  payVisible.value = true;
}

/** 初始化支付行：挂会员且余额充足时默认储值 + 现金组合，否则全额现金 */
function initPayLines() {
  const payable = payableFinal.value;
  if (member.value && member.value.balance > 0) {
    const byBalance = Math.min(member.value.balance, payable);
    const rest = payable - byBalance;
    const lines: { method: PaymentMethod; amount: string }[] = [
      { method: 'BALANCE', amount: fenToYuan(byBalance) },
    ];
    if (rest > 0) lines.push({ method: 'CASH', amount: fenToYuan(rest) });
    payLines.value = lines;
  } else {
    payLines.value = [{ method: 'CASH', amount: fenToYuan(payable) }];
  }
}

/** 积分输入变化后按新应收重排支付行 */
function onPointsChange() {
  const n = pointsUsed.value;
  if (n > maxPoints.value) pointsInput.value = String(maxPoints.value);
  initPayLines();
}

function addPayLine() {
  const used = payLines.value.map((l) => l.method);
  const next = payMethodOptions.value.find((m) => !used.includes(m));
  if (!next) return;
  payLines.value.push({ method: next, amount: '0.00' });
}

/** 结算可选支付方式：挂会员后多出「储值余额」 */
const payMethodOptions = computed<PaymentMethod[]>(() =>
  member.value ? [...POS_PAY_METHODS, 'BALANCE'] : [...POS_PAY_METHODS],
);

function removePayLine(idx: number) {
  payLines.value.splice(idx, 1);
}

async function confirmPay() {
  if (!paySumValid.value) {
    ElMessage.error('各支付方式金额之和与应付金额不一致');
    return;
  }
  if (member.value && balancePaidFen.value > member.value.balance) {
    ElMessage.error(`储值支付超出余额（可用 ${fenToYuan(member.value.balance)} 元）`);
    return;
  }
  if (pointsUsed.value > maxPoints.value) {
    ElMessage.error(`积分不足或超出可抵扣上限（最多 ${maxPoints.value}）`);
    return;
  }
  submitting.value = true;
  try {
    const payments = payLines.value
      .map((l) => ({
        method: l.method,
        amount: l.method === 'CASH' ? Math.min(yuanToFen(l.amount), cashRemaining.value) : yuanToFen(l.amount),
      }))
      .filter((p) => p.amount > 0);
    const payload = {
      items: cart.items.map((i) => ({ skuId: i.skuId, qty: i.qty, unitPrice: i.unitPrice })),
      payments,
      discountAmount: cart.discountAmount > 0 ? cart.discountAmount : undefined,
      memberId: member.value?.id,
      usePoints: member.value && pointsUsed.value > 0 ? pointsUsed.value : undefined,
    };
    let order: SaleOrderDto;
    let offline = false;
    try {
      order = await createSaleOrder(payload);
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      if (member.value) {
        ElMessage.error('会员单需要联网结算（储值/积分余额以服务端为准），请检查网络后重试');
        return;
      }
      // 断网：转为离线单，入 outbox 待同步
      offline = true;
      order = await checkoutOffline(payload);
    }
    payVisible.value = false;
    lastOrder.value = order;
    lastOrderOffline.value = offline;
    receiptVisible.value = true;
    cart.clear();
    if (order.pointsEarned && member.value) {
      ElMessage.success(`收款成功，会员「${member.value.name}」+${order.pointsEarned} 积分`);
    }
    if (cashChange.value > 0) {
      ElMessage.success(`收款成功，找零 ¥${fenToYuan(cashChange.value)}`);
    } else if (!order.pointsEarned) {
      ElMessage.success(offline ? '离线收款成功，恢复网络后自动同步' : '收款成功');
    }
    // 刷新会员余额/积分展示
    if (member.value) void refreshMember();
    // 自动打印（设置开启时）
    if (settings.settings.autoPrintReceipt) {
      const result = await printReceipt(order, auth.userName, offline);
      if (!result.ok && settings.settings.receiptPrintingEnabled) ElMessage.warning(result.message);
    }
  } catch {
    // 拦截器已提示
  } finally {
    submitting.value = false;
    refocus();
  }
}

/** 断网结算：本地生成单据与单号，入 outbox 队列，并预扣本地缓存库存 */
async function checkoutOffline(
  payload: NonNullable<Parameters<typeof createSaleOrder>[0]>,
): Promise<SaleOrderDto> {
  const clientId = crypto.randomUUID();
  const clientOrderNo = genClientOrderNo();
  const now = Date.now();
  const localOrder: SaleOrderDto = {
    id: clientId,
    orderNo: clientOrderNo,
    shiftId: null,
    cashierId: auth.user?.id ?? '',
    cashierName: auth.userName,
    status: 'NORMAL',
    items: cart.items.map((i, idx) => ({
      id: `local-${idx}`,
      skuId: i.skuId,
      productName: i.productName,
      spec: i.spec,
      barcode: i.barcode,
      unit: i.unit,
      qty: i.qty,
      unitPrice: i.unitPrice,
      subtotal: i.qty * i.unitPrice,
      refundedQty: 0,
    })),
    payments: payload.payments.map((p, idx) => ({ id: `local-p${idx}`, method: p.method, amount: p.amount })),
    totalAmount: cart.total,
    discountAmount: cart.discountAmount,
    payableAmount: cart.payable,
    remark: null,
    voidReason: null,
    createdAt: new Date(now).toISOString(),
  };
  await enqueueSale({
    clientId,
    clientOrderNo,
    createdAt: now,
    offlineCreatedAt: new Date(now).toISOString(),
    payload: {
      ...payload,
      clientId,
      clientOrderNo,
      offlineCreatedAt: now,
      discountAmount: cart.discountAmount > 0 ? cart.discountAmount : undefined,
    },
    receipt: localOrder,
    status: 'PENDING',
    attempts: 0,
  });
  await applySaleToCache(cart.items.map((i) => ({ skuId: i.skuId, qty: i.qty })));
  await sync.refresh();
  return localOrder;
}

async function doPrint() {
  if (!lastOrder.value) return;
  const result = await printReceipt(lastOrder.value, auth.userName, lastOrderOffline.value);
  if (!result.ok) ElMessage.warning(result.message);
  else ElMessage.success(result.message);
}

// 清空购物车
async function clearCart() {
  if (cart.isEmpty) return;
  await ElMessageBox.confirm('确定清空当前购物车？', '提示', { type: 'warning' });
  cart.clear();
  refocus();
}

// 快捷键
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'F1') {
    e.preventDefault();
    holdsVisible.value = true;
  } else if (e.key === 'F9') {
    e.preventDefault();
    void openPay();
  } else if (e.key === 'F4' && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    openDiscount();
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown));
onUnmounted(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <div class="register">
    <div class="left">
      <div class="scan-bar">
        <el-input
          ref="inputRef"
          v-model="barcodeInput"
          size="large"
          placeholder="扫码枪扫条码，或输入商品名/拼音后回车搜索（光标保持在此）"
          clearable
          @keyup.enter="handleInput"
        >
          <template #prepend>扫码 / 搜索</template>
        </el-input>
        <el-badge :value="cart.holds.length" :hidden="cart.holds.length === 0">
          <el-button size="large" :icon="Tickets" @click="holdsVisible = true">挂单</el-button>
        </el-badge>
      </div>

      <el-table :data="cart.items" class="cart-table" height="calc(100% - 132px)" size="large">
        <el-table-column label="商品" min-width="220">
          <template #default="{ row }">
            <div class="p-name">{{ row.productName }}</div>
            <div class="p-spec" v-if="row.spec">{{ row.spec }}</div>
          </template>
        </el-table-column>
        <el-table-column label="库存" width="80" align="center">
          <template #default="{ row }">
            <span :class="{ 'stock-low': row.stockQty <= row.qty }">{{ row.stockQty }}</span>
          </template>
        </el-table-column>
        <el-table-column label="单价" width="110" align="center">
          <template #default="{ row }">
            <el-link type="primary" @click="openPriceEdit(row)">
              {{ fenToYuan(row.unitPrice) }}
              <el-tooltip v-if="row.unitPrice !== row.retailPrice" content="已改价">
                <el-icon><CreditCard /></el-icon>
              </el-tooltip>
            </el-link>
          </template>
        </el-table-column>
        <el-table-column label="数量" width="170" align="center">
          <template #default="{ row }">
            <div class="qty-ctrl">
              <el-button size="small" :icon="Minus" @click="cart.setQty(row.skuId, row.qty - 1)" />
              <el-input-number
                :model-value="row.qty"
                :min="1"
                :max="999"
                size="small"
                controls-position="hidden"
                style="width: 60px"
                @change="(v: number | undefined) => cart.setQty(row.skuId, v ?? 1)"
              />
              <el-button size="small" :icon="Plus" @click="cart.setQty(row.skuId, row.qty + 1)" />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="小计" width="100" align="right">
          <template #default="{ row }">{{ fenToYuan(row.qty * row.unitPrice) }}</template>
        </el-table-column>
        <el-table-column width="60" align="center">
          <template #default="{ row }">
            <el-button type="danger" :icon="Delete" circle size="small" @click="cart.remove(row.skuId)" />
          </template>
        </el-table-column>
      </el-table>

      <div class="cart-footer">
        <span>共 {{ cart.count }} 件 / {{ cart.lineCount }} 种</span>
        <el-button text type="danger" @click="clearCart">清空</el-button>
      </div>
    </div>

    <div class="right">
      <div class="summary-card">
        <div v-if="member" class="member-card">
          <div class="member-line">
            <el-icon><Avatar /></el-icon>
            <b>{{ member.name }}</b>
            <span class="member-dim">{{ member.code }}</span>
            <span class="spacer"></span>
            <el-button text size="small" type="danger" @click="detachMember">解除</el-button>
          </div>
          <div class="member-line member-dim">
            储值 {{ money(member.balance) }} · 积分 {{ member.points }}
          </div>
        </div>
        <el-button v-else text class="attach-btn" :icon="Avatar" @click="memberVisible = true">
          挂会员（会员价 / 储值 / 积分）
        </el-button>
        <div class="row"><span>合计</span><b>{{ money(cart.total) }}</b></div>
        <div class="row discount" @click="openDiscount">
          <span>整单优惠（F4）</span>
          <span class="discount-value">-{{ money(cart.discountAmount) }} ✎</span>
        </div>
        <div class="row payable"><span>应收</span><b>{{ money(cart.payable) }}</b></div>
        <el-button type="primary" size="large" class="pay-btn" :disabled="cart.isEmpty" @click="openPay">
          结算 (F9)
        </el-button>
        <div class="tips">
          <div>F1 挂单列表 · F9 结算 · 单价点击改价</div>
          <div v-if="member">已挂会员：新加商品自动用会员价</div>
        </div>
      </div>
    </div>

    <!-- 挂会员 -->
    <el-dialog v-model="memberVisible" title="挂会员" width="400px" @open="memberKey = ''">
      <p class="tip-text">输入会员手机号或会员码（M 开头），扫码枪可直接扫会员卡条码</p>
      <el-input v-model="memberKey" size="large" placeholder="手机号 / 会员码" @keyup.enter="confirmAttachMember" />
      <template #footer>
        <el-button @click="memberVisible = false">取消</el-button>
        <el-button type="primary" :loading="memberLoading" @click="confirmAttachMember">确认挂单</el-button>
      </template>
    </el-dialog>

    <!-- 搜索结果 -->
    <el-dialog v-model="searchVisible" :title="`搜索「${searchKeyword}」`" width="640px">
      <el-table :data="searchResults" max-height="420" @row-click="(p: (typeof searchResults.value)[number]) => pickProduct(p, p.skus[0]!)">
        <el-table-column label="商品" min-width="200">
          <template #default="{ row }">{{ row.name }}</template>
        </el-table-column>
        <el-table-column label="规格" min-width="110">
          <template #default="{ row }">{{ specList(row) }}</template>
        </el-table-column>
        <el-table-column label="单价" width="100" align="right">
          <template #default="{ row }">{{ fenToYuan(row.skus[0]?.retailPrice ?? 0) }}</template>
        </el-table-column>
        <el-table-column label="库存" width="80" align="center">
          <template #default="{ row }">{{ row.skus[0]?.qty ?? 0 }}</template>
        </el-table-column>
      </el-table>
      <div class="tip-text">多规格商品请到「商品管理」中按条码区分；此处默认加入第一个 SKU</div>
    </el-dialog>

    <!-- 改价 -->
    <el-dialog v-model="priceDialog" title="改价" width="380px">
      <div v-if="priceEditTarget">
        <p>{{ priceEditTarget.name }}</p>
        <p class="tip-text">当前单价 {{ fenToYuan(priceEditTarget.current) }} 元<template v-if="priceEditTarget.minPrice !== null">，最低售价 {{ fenToYuan(priceEditTarget.minPrice) }} 元</template></p>
        <el-input v-model="priceNewValue" size="large" @keyup.enter="confirmPriceEdit">
          <template #append>元</template>
        </el-input>
      </div>
      <template #footer>
        <el-button @click="priceDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmPriceEdit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 整单折扣 -->
    <el-dialog v-model="discountVisible" title="整单优惠" width="380px">
      <p class="tip-text">合计 {{ money(cart.total) }}，优惠金额（元）</p>
      <el-input v-model="discountValue" size="large" @keyup.enter="confirmDiscount">
        <template #append>元</template>
      </el-input>
      <template #footer>
        <el-button @click="discountVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmDiscount">确定</el-button>
      </template>
    </el-dialog>

    <!-- 老板授权 -->
    <BossAuthDialog v-model:visible="authVisible" title="改价/折扣超出权限，需要老板授权" @granted="onGranted" />

    <!-- 挂单列表 -->
    <el-drawer v-model="holdsVisible" title="挂单列表 (F1)" size="360px">
      <el-empty v-if="cart.holds.length === 0" description="暂无挂单" />
      <div v-for="(hold, idx) in cart.holds" :key="hold.savedAt" class="hold-item">
        <div>
          <div>#{{ idx + 1 }} · {{ formatTime(new Date(hold.savedAt)) }} · {{ hold.items.length }} 种</div>
          <div class="tip-text">{{ hold.items.map((i) => i.productName).join('、').slice(0, 40) }}</div>
        </div>
        <div>
          <el-button type="primary" size="small" @click="doRecall(idx)">取单</el-button>
          <el-button size="small" type="danger" plain @click="removeHold(idx)">删除</el-button>
        </div>
      </div>
    </el-drawer>

    <!-- 结算 -->
    <el-dialog v-model="payVisible" title="收银结算" width="520px" :close-on-click-modal="false">
      <div class="pay-head">
        <span>应收金额</span>
        <b class="pay-amount">{{ money(payableFinal) }}</b>
      </div>
      <div v-if="member" class="points-block">
        <span class="points-label">积分抵扣（可用 {{ member.points }}，{{ pointValueCent }} 分/积分）</span>
        <el-input v-model="pointsInput" size="small" style="width: 130px" placeholder="0" @change="onPointsChange">
          <template #append>积分</template>
        </el-input>
        <span v-if="pointsUsed > 0" class="points-value">已抵扣 {{ money(pointsDiscount) }}</span>
      </div>
      <div v-for="(line, idx) in payLines" :key="idx" class="pay-line">
        <el-select v-model="line.method" style="width: 130px" size="large">
          <el-option v-for="m in payMethodOptions" :key="m" :value="m" :label="PAYMENT_METHOD_LABELS[m]" />
        </el-select>
        <el-input v-model="line.amount" size="large" placeholder="金额（元）">
          <template #append>元</template>
        </el-input>
        <el-button v-if="payLines.length > 1" text type="danger" @click="removePayLine(idx)">删除</el-button>
      </div>
      <div v-if="balanceLine && member" class="change-row">
        储值余额 {{ money(member.balance) }}，本单储值支付 {{ money(balancePaidFen) }}
      </div>
      <div v-if="cashLine" class="change-row" :class="{ ok: cashChange > 0 }">
        <template v-if="cashChange > 0">找零：<b>{{ money(cashChange) }}</b></template>
        <template v-else>现金应收 {{ money(cashRemaining) }}</template>
      </div>
      <el-button text type="primary" @click="addPayLine">+ 添加支付方式（组合支付）</el-button>
      <template #footer>
        <el-button @click="payVisible = false">取消</el-button>
        <el-button type="primary" size="large" :loading="submitting" :disabled="!paySumValid" @click="confirmPay">
          完成收款
        </el-button>
      </template>
    </el-dialog>

    <!-- 小票 -->
    <el-dialog v-model="receiptVisible" title="收款成功" width="360px">
      <div style="text-align: center">
        <p class="pay-amount ok-color">{{ lastOrder ? money(lastOrder.payableAmount) : '' }}</p>
        <el-tag v-if="lastOrderOffline" type="warning" effect="plain">离线单 · 恢复网络后自动同步</el-tag>
      </div>
      <div v-if="lastOrder" style="max-height: 320px; overflow: auto; border: 1px dashed #ddd; padding: 4px">
        <ReceiptView ref="receiptRef" :order="lastOrder" :cashier-name="auth.userName" :offline="lastOrderOffline" />
      </div>
      <template #footer>
        <el-button @click="receiptVisible = false">关闭</el-button>
        <el-button v-if="canPrint" type="primary" @click="doPrint">打印小票</el-button>
        <span v-else class="tip-text">打印未开启（系统设置 → 打印设置）</span>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.register {
  display: flex;
  gap: 12px;
  height: calc(100vh - 88px);
}
.left {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}
.scan-bar {
  display: flex;
  gap: 10px;
  align-items: center;
}
.scan-bar .el-input {
  flex: 1;
}
.cart-table {
  flex: 1;
}
.cart-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #57606f;
}
.right {
  width: 280px;
}
.summary-card {
  background: #fff;
  border-radius: 8px;
  padding: 20px 16px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.summary-card .row {
  display: flex;
  justify-content: space-between;
  font-size: 15px;
}
.member-card {
  background: #f0f7ff;
  border-radius: 6px;
  padding: 8px 10px;
}
.member-line {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.member-line .spacer {
  flex: 1;
}
.member-dim {
  color: #7a8ba0;
  font-size: 12px;
}
.attach-btn {
  justify-content: flex-start;
  color: #4b7bec;
  padding-left: 0;
}
.points-block {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 8px 10px;
  background: #fff7e6;
  border-radius: 6px;
}
.points-label {
  font-size: 12px;
  color: #8d6e2f;
  flex: 1;
}
.points-value {
  color: #eb3b5a;
  font-size: 13px;
  font-weight: 600;
}
.payable {
  font-size: 22px !important;
  color: #eb3b5a;
}
.discount {
  cursor: pointer;
  color: #4b7bec;
}
.pay-btn {
  width: 100%;
  height: 56px;
  font-size: 18px;
}
.tips {
  color: #a4b0be;
  font-size: 12px;
  text-align: center;
}
.p-spec {
  color: #a4b0be;
  font-size: 12px;
}
.stock-low {
  color: #eb3b5a;
  font-weight: 600;
}
.qty-ctrl {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: center;
}
.hold-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 4px;
  border-bottom: 1px solid #f1f2f6;
}
.pay-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 14px;
  font-size: 16px;
}
.pay-amount {
  font-size: 26px;
  color: #eb3b5a;
}
.ok-color {
  color: #20bf6b;
}
.pay-line {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.pay-line .el-input {
  flex: 1;
}
.change-row {
  margin: 8px 0;
  color: #57606f;
}
.change-row.ok b {
  color: #20bf6b;
  font-size: 18px;
}
.tip-text {
  color: #a4b0be;
  font-size: 12px;
}
</style>
