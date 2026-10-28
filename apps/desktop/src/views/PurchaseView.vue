<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Search } from '@element-plus/icons-vue';
import { PURCHASE_STATUS_LABELS } from '@pos/shared-types';
import type { PurchaseOrderDto, SupplierDto } from '@pos/shared-types';
import {
  cancelPurchase,
  createPurchase,
  createSupplier,
  deleteSupplier,
  getPurchaseOrder,
  listProducts,
  listPurchaseOrders,
  listSuppliers,
  payPurchase,
  purchasePayables,
  receivePurchase,
  updateSupplier,
} from '@/api';
import { fenToYuan, yuanToFen, money, formatDateTime } from '@/utils/money';

const tab = ref('orders');

// ---------- 采购单列表 ----------

const orders = ref<PurchaseOrderDto[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const statusFilter = ref('');
const keyword = ref('');

async function loadOrders() {
  loading.value = true;
  try {
    const res = await listPurchaseOrders({
      page: page.value,
      pageSize: pageSize.value,
      ...(statusFilter.value ? { status: statusFilter.value } : {}),
      ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
    });
    orders.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

// ---------- 采购单详情 ----------

const detail = ref<PurchaseOrderDto | null>(null);
const detailVisible = ref(false);

async function openDetail(id: string) {
  detail.value = await getPurchaseOrder(id);
  detailVisible.value = true;
}

// 分批入库：按行编辑本次实收数量（默认 = 剩余待收）
const receiveVisible = ref(false);
const receiveTarget = ref<PurchaseOrderDto | null>(null);
const receiveQty = ref<Record<string, number>>({});
const receiveSubmitting = ref(false);

function openReceive(o: PurchaseOrderDto) {
  receiveTarget.value = o;
  const map: Record<string, number> = {};
  for (const item of o.items ?? []) {
    map[item.id] = Math.max(0, item.qty - item.receivedQty);
  }
  receiveQty.value = map;
  receiveVisible.value = true;
}

async function confirmReceive() {
  const o = receiveTarget.value;
  if (!o) return;
  const items = (o.items ?? [])
    .map((item) => ({ itemId: item.id, qty: receiveQty.value[item.id] ?? 0 }))
    .filter((r) => r.qty > 0);
  if (items.length === 0) {
    ElMessage.warning('本次入库数量为 0，请填写各行的实收数量');
    return;
  }
  receiveSubmitting.value = true;
  try {
    await receivePurchase(o.id, { items });
    ElMessage.success('入库成功');
    receiveVisible.value = false;
    void loadOrders();
    void loadSuppliers();
    if (detailVisible.value && detail.value?.id === o.id) detail.value = await getPurchaseOrder(o.id);
  } catch {
    // 拦截器已提示
  } finally {
    receiveSubmitting.value = false;
  }
}

async function doCancel(o: PurchaseOrderDto) {
  await ElMessageBox.confirm(`确定取消采购单 ${o.orderNo}？`, '取消采购', { type: 'warning' });
  await cancelPurchase(o.id);
  ElMessage.success('已取消');
  void loadOrders();
  if (detailVisible.value && detail.value?.id === o.id) detail.value = await getPurchaseOrder(o.id);
}

// 付款
const payVisible = ref(false);
const payTarget = ref<PurchaseOrderDto | null>(null);
const payAmount = ref('');
const payMethod = ref<'CASH' | 'WECHAT' | 'ALIPAY' | 'CARD' | 'OTHER'>('CASH');
const payNote = ref('');

function openPay(o: PurchaseOrderDto) {
  payTarget.value = o;
  payAmount.value = fenToYuan(o.payableAmount);
  payMethod.value = 'CASH';
  payNote.value = '';
  payVisible.value = true;
}

async function confirmPay() {
  const o = payTarget.value;
  if (!o) return;
  const fen = yuanToFen(payAmount.value);
  if (fen <= 0 || fen > o.payableAmount) {
    ElMessage.warning('付款金额不合法');
    return;
  }
  const updated = await payPurchase(o.id, { amount: fen, method: payMethod.value, note: payNote.value || undefined });
  ElMessage.success('付款已登记');
  payVisible.value = false;
  void loadOrders();
  if (detailVisible.value && detail.value?.id === o.id) detail.value = updated;
}

// ---------- 新建采购单 ----------

const createVisible = ref(false);
const suppliers = ref<(SupplierDto & { receivedTotal: number; paidTotal: number; payable: number })[]>([]);
const createSupplierId = ref('');
const createRemark = ref('');
interface DraftLine {
  skuId: string;
  productName: string;
  spec: string | null;
  unit: string;
  qty: number;
  unitCostYuan: string;
  lastCost: number | null;
}
const draftLines = ref<DraftLine[]>([]);

async function openCreate() {
  suppliers.value = await listSuppliers();
  if (suppliers.value.length === 0) {
    ElMessage.warning('请先在「供应商」页签添加供应商');
    tab.value = 'suppliers';
    return;
  }
  createSupplierId.value = suppliers.value[0]!.id;
  createRemark.value = '';
  draftLines.value = [];
  createVisible.value = true;
}

const draftTotal = computed(() =>
  draftLines.value.reduce((n, l) => n + l.qty * yuanToFen(l.unitCostYuan), 0),
);

// 商品搜索
const pickVisible = ref(false);
const pickKeyword = ref('');
const pickResults = ref<Awaited<ReturnType<typeof listProducts>>['items']>([]);

async function openPick() {
  pickKeyword.value = '';
  pickResults.value = [];
  pickVisible.value = true;
}

async function doPickSearch() {
  if (!pickKeyword.value.trim()) return;
  const res = await listProducts({ keyword: pickKeyword.value.trim(), pageSize: 30 });
  pickResults.value = res.items.filter((p) => p.skus.length > 0);
}

function addSku(p: (typeof pickResults.value)[number], sku: (typeof p.skus)[number]) {
  if (draftLines.value.some((l) => l.skuId === sku.id)) {
    ElMessage.warning('该商品已在单据中');
    return;
  }
  draftLines.value.push({
    skuId: sku.id,
    productName: p.name,
    spec: sku.spec,
    unit: p.unit,
    qty: 1,
    unitCostYuan: sku.lastCost != null ? fenToYuan(sku.lastCost) : '',
    lastCost: sku.lastCost ?? null,
  });
  pickVisible.value = false;
}

async function confirmCreate() {
  if (!createSupplierId.value) {
    ElMessage.warning('请选择供应商');
    return;
  }
  const items = draftLines.value.map((l) => ({
    skuId: l.skuId,
    qty: l.qty,
    unitCost: yuanToFen(l.unitCostYuan),
  }));
  if (items.length === 0) {
    ElMessage.warning('请至少添加一个商品');
    return;
  }
  if (items.some((i) => i.qty < 1)) {
    ElMessage.warning('商品数量不合法');
    return;
  }
  await createPurchase({
    supplierId: createSupplierId.value,
    items,
    remark: createRemark.value || undefined,
  });
  ElMessage.success('采购单已创建（待入库）');
  createVisible.value = false;
  page.value = 1;
  void loadOrders();
}

// ---------- 供应商 ----------

const supplierKeyword = ref('');
const supplierFormVisible = ref(false);
const supplierForm = ref({ id: '', name: '', phone: '', contact: '', remark: '' });

async function loadSuppliers() {
  suppliers.value = await listSuppliers(supplierKeyword.value || undefined);
}

function openSupplierCreate() {
  supplierForm.value = { id: '', name: '', phone: '', contact: '', remark: '' };
  supplierFormVisible.value = true;
}

function openSupplierEdit(s: SupplierDto) {
  supplierForm.value = {
    id: s.id,
    name: s.name,
    phone: s.phone ?? '',
    contact: s.contact ?? '',
    remark: s.remark ?? '',
  };
  supplierFormVisible.value = true;
}

async function saveSupplier() {
  const f = supplierForm.value;
  if (!f.name.trim()) {
    ElMessage.warning('请填写供应商名称');
    return;
  }
  const data = {
    name: f.name.trim(),
    phone: f.phone || null,
    contact: f.contact || null,
    remark: f.remark || null,
  };
  if (f.id) await updateSupplier(f.id, data);
  else await createSupplier(data);
  ElMessage.success('已保存');
  supplierFormVisible.value = false;
  void loadSuppliers();
}

async function removeSupplier(s: SupplierDto) {
  await ElMessageBox.confirm(
    s.orderCount
      ? `供应商「${s.name}」已有采购记录，删除后将停用（历史账目保留）。`
      : `确定删除供应商「${s.name}」？`,
    '删除供应商',
    { type: 'warning' },
  );
  await deleteSupplier(s.id);
  ElMessage.success('已删除');
  void loadSuppliers();
}

// ---------- 应付汇总 ----------

const payables = ref<Awaited<ReturnType<typeof purchasePayables>>>([]);

async function loadPayables() {
  payables.value = await purchasePayables();
}

function switchTab(t: string | number) {
  if (t === 'suppliers') void loadSuppliers();
  else if (t === 'payables') void loadPayables();
}

onMounted(() => {
  void loadOrders();
});
</script>

<template>
  <div class="page">
    <el-tabs v-model="tab" @tab-change="switchTab">
      <!-- 采购单 -->
      <el-tab-pane label="采购单" name="orders">
        <div class="toolbar">
          <el-select v-model="statusFilter" placeholder="状态" clearable style="width: 120px" @change="page = 1; loadOrders()">
            <el-option v-for="(label, s) in PURCHASE_STATUS_LABELS" :key="s" :value="s" :label="label" />
          </el-select>
          <el-input
            v-model="keyword"
            placeholder="采购单号"
            clearable
            style="width: 200px"
            @keyup.enter="page = 1; loadOrders()"
          />
          <el-button type="primary" :icon="Search" @click="page = 1; loadOrders()">查询</el-button>
          <div class="spacer" />
          <el-button type="primary" :icon="Plus" @click="openCreate">新建采购单</el-button>
        </div>
        <el-table v-loading="loading" :data="orders" size="large">
          <el-table-column label="采购单号" prop="orderNo" width="160" />
          <el-table-column label="供应商" prop="supplierName" min-width="120" />
          <el-table-column label="状态" width="90" align="center">
            <template #default="{ row }">
              <el-tag :type="row.status === 'RECEIVED' ? 'success' : row.status === 'DRAFT' ? 'warning' : 'info'">
                {{ PURCHASE_STATUS_LABELS[row.status as keyof typeof PURCHASE_STATUS_LABELS] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="采购额" width="100" align="right">
            <template #default="{ row }">{{ money(row.totalAmount) }}</template>
          </el-table-column>
          <el-table-column label="已入库" width="110" align="right">
            <template #default="{ row }">
              {{ money(row.receivedAmount ?? 0) }}
              <span v-if="row.totalQty" class="receive-progress">{{ row.receivedQty ?? 0 }}/{{ row.totalQty }}</span>
            </template>
          </el-table-column>
          <el-table-column label="已付" width="100" align="right">
            <template #default="{ row }">{{ money(row.paidAmount) }}</template>
          </el-table-column>
          <el-table-column label="应付余额" width="100" align="right">
            <template #default="{ row }">
              <span :class="{ 'pay-pending': row.payableAmount > 0 }">{{ money(row.payableAmount) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="创建时间" width="150">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="250" align="center">
            <template #default="{ row }">
              <el-button size="small" @click="openDetail(row.id)">详情</el-button>
              <el-button v-if="row.status === 'DRAFT'" size="small" type="success" @click="openReceive(row)">
                {{ (row.receivedQty ?? 0) > 0 ? '继续入库' : '入库' }}
              </el-button>
              <el-button v-if="(row.receivedAmount ?? 0) > 0 && row.payableAmount > 0" size="small" type="primary" @click="openPay(row)">付款</el-button>
              <el-button v-if="row.status === 'DRAFT' && !(row.receivedQty ?? 0)" size="small" type="danger" plain @click="doCancel(row)">取消</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="total"
          layout="total, prev, pager, next"
          class="pager"
          @current-change="loadOrders"
        />
      </el-tab-pane>

      <!-- 供应商 -->
      <el-tab-pane label="供应商" name="suppliers">
        <div class="toolbar">
          <el-input v-model="supplierKeyword" placeholder="供应商名称" clearable style="width: 200px" @keyup.enter="loadSuppliers()" />
          <el-button type="primary" :icon="Search" @click="loadSuppliers()">查询</el-button>
          <div class="spacer" />
          <el-button type="primary" :icon="Plus" @click="openSupplierCreate">新增供应商</el-button>
        </div>
        <el-table :data="suppliers" size="large">
          <el-table-column label="名称" prop="name" min-width="140" />
          <el-table-column label="电话" prop="phone" width="130" />
          <el-table-column label="联系人" prop="contact" width="100" />
          <el-table-column label="采购次数" prop="orderCount" width="90" align="center" />
          <el-table-column label="应付余额" width="110" align="right">
            <template #default="{ row }">
              <span :class="{ 'pay-pending': row.payable > 0 }">{{ money(row.payable) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="备注" prop="remark" min-width="120" show-overflow-tooltip />
          <el-table-column label="操作" width="160" align="center">
            <template #default="{ row }">
              <el-button size="small" @click="openSupplierEdit(row)">编辑</el-button>
              <el-button size="small" type="danger" plain @click="removeSupplier(row)">删除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-tab-pane>

      <!-- 应付汇总 -->
      <el-tab-pane label="应付汇总" name="payables">
        <div class="toolbar">
          <span class="tip">按供应商汇总：已入库采购额 − 累计付款（含预付）</span>
          <div class="spacer" />
          <el-button :icon="Search" @click="loadPayables">刷新</el-button>
        </div>
        <el-table :data="payables" size="large">
          <el-table-column label="供应商" prop="supplierName" min-width="150" />
          <el-table-column label="电话" prop="phone" width="130" />
          <el-table-column label="入库采购额" width="120" align="right">
            <template #default="{ row }">{{ money(row.receivedTotal) }}</template>
          </el-table-column>
          <el-table-column label="已付款" width="110" align="right">
            <template #default="{ row }">{{ money(row.paidTotal) }}</template>
          </el-table-column>
          <el-table-column label="应付余额" width="120" align="right">
            <template #default="{ row }">
              <span :class="{ 'pay-pending': row.payable > 0 }">{{ money(row.payable) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="采购单数" prop="orderCount" width="90" align="center" />
        </el-table>
      </el-tab-pane>
    </el-tabs>

    <!-- 新建采购单 -->
    <el-dialog v-model="createVisible" title="新建采购单" width="780px" :close-on-click-modal="false">
      <el-form label-width="80px">
        <el-form-item label="供应商">
          <el-select v-model="createSupplierId" style="width: 280px">
            <el-option v-for="s in suppliers" :key="s.id" :value="s.id" :label="s.name" />
          </el-select>
        </el-form-item>
      </el-form>
      <div class="toolbar" style="margin-bottom: 8px">
        <el-button :icon="Plus" @click="openPick">添加商品</el-button>
        <div class="spacer" />
        <span>合计：<b class="pay-pending">{{ money(draftTotal) }}</b></span>
      </div>
      <el-table :data="draftLines" size="small" max-height="300">
        <el-table-column label="商品" min-width="180">
          <template #default="{ row }">
            {{ row.productName }} <span v-if="row.spec" class="spec">{{ row.spec }}</span>
          </template>
        </el-table-column>
        <el-table-column label="数量" width="130" align="center">
          <template #default="{ row }">
            <el-input-number v-model="row.qty" :min="1" :max="99999" size="small" controls-position="hidden" style="width: 90px" />
          </template>
        </el-table-column>
        <el-table-column label="进价（元）" width="150" align="center">
          <template #default="{ row }">
            <el-input v-model="row.unitCostYuan" size="small" style="width: 110px" :placeholder="row.lastCost != null ? `最近 ${fenToYuan(row.lastCost)}` : '进价'" />
          </template>
        </el-table-column>
        <el-table-column label="小计" width="100" align="right">
          <template #default="{ row }">{{ money(row.qty * yuanToFen(row.unitCostYuan)) }}</template>
        </el-table-column>
        <el-table-column width="60" align="center">
          <template #default="{ $index }">
            <el-button size="small" type="danger" text @click="draftLines.splice($index, 1)">删</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-input v-model="createRemark" placeholder="备注（可选）" style="margin-top: 10px" />
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmCreate">保存（待入库）</el-button>
      </template>
    </el-dialog>

    <!-- 商品选择 -->
    <el-dialog v-model="pickVisible" title="选择商品" width="680px">
      <div class="toolbar" style="margin-bottom: 8px">
        <el-input v-model="pickKeyword" placeholder="商品名 / 拼音 / 条码" style="width: 240px" @keyup.enter="doPickSearch" />
        <el-button type="primary" :icon="Search" @click="doPickSearch">搜索</el-button>
      </div>
      <el-table :data="pickResults" size="small" max-height="360">
        <el-table-column label="商品" min-width="160">
          <template #default="{ row }">{{ row.name }}</template>
        </el-table-column>
        <el-table-column label="SKU" min-width="140">
          <template #default="{ row }">
            <div v-for="sku in row.skus" :key="sku.id" class="sku-row">
              <span>{{ sku.spec || '默认规格' }}</span>
              <el-button size="small" type="primary" text @click="addSku(row, sku)">添加</el-button>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="库存" width="70" align="center">
          <template #default="{ row }">{{ row.skus[0]?.qty ?? 0 }}</template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <!-- 付款 -->
    <el-dialog v-model="payVisible" title="采购付款" width="400px">
      <p v-if="payTarget" class="tip">
        {{ payTarget.orderNo }} · 应付余额 {{ money(payTarget.payableAmount) }}
      </p>
      <el-form label-width="80px">
        <el-form-item label="金额">
          <el-input v-model="payAmount" size="large">
            <template #append>元</template>
          </el-input>
        </el-form-item>
        <el-form-item label="方式">
          <el-radio-group v-model="payMethod">
            <el-radio-button value="CASH">现金</el-radio-button>
            <el-radio-button value="WECHAT">微信</el-radio-button>
            <el-radio-button value="ALIPAY">支付宝</el-radio-button>
            <el-radio-button value="CARD">转账</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="payNote" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="payVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmPay">登记付款</el-button>
      </template>
    </el-dialog>

    <!-- 分批入库 -->
    <el-dialog v-model="receiveVisible" title="采购入库（支持分批到货）" width="640px" :close-on-click-modal="false">
      <p v-if="receiveTarget" class="tip">
        {{ receiveTarget.orderNo }} · {{ receiveTarget.supplierName }} · 支持多次到货，全部收齐后自动完成
      </p>
      <el-table v-if="receiveTarget" :data="receiveTarget.items" size="small" border max-height="360">
        <el-table-column label="商品" min-width="180">
          <template #default="{ row }">
            {{ row.productName }}<span v-if="row.spec" class="tip"> {{ row.spec }}</span>
          </template>
        </el-table-column>
        <el-table-column label="订购" width="70" align="center" prop="qty" />
        <el-table-column label="已收" width="70" align="center" prop="receivedQty" />
        <el-table-column label="本次实收" width="160" align="center">
          <template #default="{ row }">
            <el-input-number
              v-model="receiveQty[row.id]"
              :min="0"
              :max="row.qty - row.receivedQty"
              size="small"
              :disabled="row.qty - row.receivedQty === 0"
            />
          </template>
        </el-table-column>
        <el-table-column label="单价" width="90" align="right">
          <template #default="{ row }">{{ money(row.unitCost) }}</template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="receiveVisible = false">取消</el-button>
        <el-button type="primary" :loading="receiveSubmitting" @click="confirmReceive">确认入库</el-button>
      </template>
    </el-dialog>

    <!-- 采购单详情 -->
    <el-drawer v-model="detailVisible" :title="detail ? `采购单 ${detail.orderNo}` : ''" size="560px">
      <template v-if="detail">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="供应商">{{ detail.supplierName }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag :type="detail.status === 'RECEIVED' ? 'success' : detail.status === 'DRAFT' ? 'warning' : 'info'">
              {{ PURCHASE_STATUS_LABELS[detail.status as keyof typeof PURCHASE_STATUS_LABELS] }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="采购额">{{ money(detail.totalAmount) }}</el-descriptions-item>
          <el-descriptions-item label="应付余额">
            <span :class="{ 'pay-pending': detail.payableAmount > 0 }">{{ money(detail.payableAmount) }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="创建">{{ formatDateTime(detail.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="入库">{{ detail.receivedAt ? formatDateTime(detail.receivedAt) : '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.remark" label="备注" :span="2">{{ detail.remark }}</el-descriptions-item>
        </el-descriptions>

        <h4>商品明细</h4>
        <el-table :data="detail.items" size="small">
          <el-table-column label="商品" min-width="150">
            <template #default="{ row }">
              {{ row.productName }} <span v-if="row.spec" class="spec">{{ row.spec }}</span>
            </template>
          </el-table-column>
          <el-table-column label="数量" prop="qty" width="70" align="center" />
          <el-table-column label="进价" width="90" align="right">
            <template #default="{ row }">{{ fenToYuan(row.unitCost) }}</template>
          </el-table-column>
          <el-table-column label="小计" width="90" align="right">
            <template #default="{ row }">{{ fenToYuan(row.subtotal) }}</template>
          </el-table-column>
        </el-table>

        <h4>付款记录</h4>
        <el-table v-if="detail.payments && detail.payments.length" :data="detail.payments" size="small">
          <el-table-column label="时间" width="140">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="金额" width="90" align="right">
            <template #default="{ row }">{{ fenToYuan(row.amount) }}</template>
          </el-table-column>
          <el-table-column label="备注" prop="note" min-width="100" />
        </el-table>
        <el-empty v-else description="暂无付款" :image-size="60" />

        <div class="drawer-actions">
          <el-button v-if="detail.status === 'DRAFT'" type="success" @click="openReceive(detail)">
            {{ (detail.receivedQty ?? 0) > 0 ? '继续入库' : '确认入库' }}
          </el-button>
          <el-button v-if="(detail.receivedAmount ?? 0) > 0 && detail.payableAmount > 0" type="primary" @click="openPay(detail)">登记付款</el-button>
          <el-button v-if="detail.status === 'DRAFT' && !(detail.receivedQty ?? 0)" type="danger" plain @click="doCancel(detail)">取消采购</el-button>
        </div>
      </template>
    </el-drawer>

    <!-- 供应商编辑 -->
    <el-dialog v-model="supplierFormVisible" :title="supplierForm.id ? '编辑供应商' : '新增供应商'" width="420px">
      <el-form label-width="70px">
        <el-form-item label="名称">
          <el-input v-model="supplierForm.name" />
        </el-form-item>
        <el-form-item label="电话">
          <el-input v-model="supplierForm.phone" />
        </el-form-item>
        <el-form-item label="联系人">
          <el-input v-model="supplierForm.contact" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="supplierForm.remark" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="supplierFormVisible = false">取消</el-button>
        <el-button type="primary" @click="saveSupplier">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
}
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}
.toolbar .spacer {
  flex: 1;
}
.pager {
  margin-top: 12px;
  justify-content: flex-end;
}
.pay-pending {
  color: #eb3b5a;
  font-weight: 600;
}
.receive-progress {
  color: #a4b0be;
  font-size: 12px;
  margin-left: 4px;
}
.spec {
  color: #a4b0be;
  font-size: 12px;
}
.sku-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 2px 0;
}
.drawer-actions {
  margin-top: 16px;
  display: flex;
  gap: 8px;
}
.tip {
  color: #57606f;
  font-size: 13px;
}
h4 {
  margin: 16px 0 8px;
}
</style>
