<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Delete, Plus, Minus, Tickets, CreditCard } from '@element-plus/icons-vue';
import type { PaymentMethod, SaleOrderDto } from '@pos/shared-types';
import { PAYMENT_METHOD_LABELS } from '@pos/shared-types';
import { findByBarcode, listProducts, createSaleOrder, currentShift } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useCartStore } from '@/stores/cart';
import { useSettingsStore } from '@/stores/settings';
import { fenToYuan, yuanToFen, money, formatTime } from '@/utils/money';
import BossAuthDialog from '@/components/BossAuthDialog.vue';
import ReceiptView from '@/components/ReceiptView.vue';

const auth = useAuthStore();
const cart = useCartStore();
const settings = useSettingsStore();
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
const receiptVisible = ref(false);
const receiptRef = ref<InstanceType<typeof ReceiptView> | null>(null);

const cashLine = computed(() => payLines.value.find((l) => l.method === 'CASH'));
const nonCashSum = computed(() =>
  payLines.value.filter((l) => l.method !== 'CASH').reduce((s, l) => s + yuanToFen(l.amount), 0),
);
const cashRemaining = computed(() => Math.max(0, cart.payable - nonCashSum.value));
const cashChange = computed(() => {
  const paid = yuanToFen(cashLine.value?.amount ?? '0');
  return Math.max(0, paid - cashRemaining.value);
});
const paySumValid = computed(() => {
  const cashPaid = Math.min(yuanToFen(cashLine.value?.amount ?? '0'), cashRemaining.value);
  return nonCashSum.value + cashPaid === cart.payable;
});

function refocus() {
  void nextTick(() => inputRef.value?.focus());
}

onMounted(() => {
  void settings.load();
  refocus();
});

// ---------- 扫码 / 搜索 ----------

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

async function addByBarcode(code: string) {
  const hit = await findByBarcode(code);
  if (!hit || hit.productStatus !== 'ON_SALE' || hit.sku.status !== 'ON_SALE') {
    ElMessage.warning(`未找到在售商品：${code}`);
    return;
  }
  cart.add({
    skuId: hit.sku.id,
    productName: hit.productName,
    spec: hit.sku.spec,
    barcode: hit.sku.barcode,
    unit: hit.unit,
    unitPrice: hit.sku.retailPrice,
    retailPrice: hit.sku.retailPrice,
    minPrice: hit.sku.minPrice,
    stockQty: hit.sku.qty ?? 0,
  });
}

async function search(keyword: string) {
  searchKeyword.value = keyword;
  const result = await listProducts({ keyword, pageSize: 20 });
  if (result.items.length === 0) {
    ElMessage.info(`没有匹配「${keyword}」的商品`);
    return;
  }
  if (result.items.length === 1 && result.items[0]!.skus.length === 1) {
    const p = result.items[0]!;
    const sku = p.skus[0]!;
    cart.add({
      skuId: sku.id,
      productName: p.name,
      spec: sku.spec,
      barcode: sku.barcode,
      unit: p.unit,
      unitPrice: sku.retailPrice,
      retailPrice: sku.retailPrice,
      minPrice: sku.minPrice,
      stockQty: sku.qty ?? 0,
    });
    return;
  }
  searchResults.value = result.items;
  searchVisible.value = true;
}

function pickProduct(p: (typeof searchResults.value)[number], sku: (typeof p.skus)[number]) {
  cart.add({
    skuId: sku.id,
    productName: p.name,
    spec: sku.spec,
    barcode: sku.barcode,
    unit: p.unit,
    unitPrice: sku.retailPrice,
    retailPrice: sku.retailPrice,
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
  // 校验班次
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
  } catch {
    return;
  }
  payLines.value = [{ method: 'CASH', amount: fenToYuan(cart.payable) }];
  payVisible.value = true;
}

function addPayLine() {
  const used = payLines.value.map((l) => l.method);
  const next = (Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).find((m) => !used.includes(m));
  if (!next) return;
  payLines.value.push({ method: next, amount: '0.00' });
}

function removePayLine(idx: number) {
  payLines.value.splice(idx, 1);
}

async function confirmPay() {
  if (!paySumValid.value) {
    ElMessage.error('各支付方式金额之和与应付金额不一致');
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
    const order = await createSaleOrder({
      items: cart.items.map((i) => ({ skuId: i.skuId, qty: i.qty, unitPrice: i.unitPrice })),
      payments,
      discountAmount: cart.discountAmount > 0 ? cart.discountAmount : undefined,
    });
    payVisible.value = false;
    lastOrder.value = order;
    receiptVisible.value = true;
    cart.clear();
    if (cashChange.value > 0) {
      ElMessage.success(`收款成功，找零 ¥${fenToYuan(cashChange.value)}`);
    }
  } catch {
    // 拦截器已提示
  } finally {
    submitting.value = false;
    refocus();
  }
}

function printReceipt() {
  receiptRef.value?.print();
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
        </div>
      </div>
    </div>

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
        <b class="pay-amount">{{ money(cart.payable) }}</b>
      </div>
      <div v-for="(line, idx) in payLines" :key="idx" class="pay-line">
        <el-select v-model="line.method" style="width: 130px" size="large">
          <el-option v-for="(label, m) in PAYMENT_METHOD_LABELS" :key="m" :value="m" :label="label" />
        </el-select>
        <el-input v-model="line.amount" size="large" placeholder="金额（元）">
          <template #append>元</template>
        </el-input>
        <el-button v-if="payLines.length > 1" text type="danger" @click="removePayLine(idx)">删除</el-button>
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
      </div>
      <div v-if="lastOrder" style="max-height: 320px; overflow: auto; border: 1px dashed #ddd; padding: 4px">
        <ReceiptView ref="receiptRef" :order="lastOrder" :cashier-name="auth.userName" />
      </div>
      <template #footer>
        <el-button @click="receiptVisible = false">关闭</el-button>
        <el-button type="primary" @click="printReceipt">打印小票</el-button>
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
