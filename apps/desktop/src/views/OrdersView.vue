<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { SaleOrderDto } from '@pos/shared-types';
import { PAYMENT_METHOD_LABELS } from '@pos/shared-types';
import { listOrders, voidOrder } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { fenToYuan, formatDateTime } from '@/utils/money';

const auth = useAuthStore();
const items = ref<SaleOrderDto[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const keyword = ref('');
const loading = ref(false);
const detail = ref<SaleOrderDto | null>(null);
const detailVisible = ref(false);

async function load() {
  loading.value = true;
  try {
    const result = await listOrders({ page: page.value, pageSize, keyword: keyword.value || undefined });
    items.value = result.items;
    total.value = result.total;
  } finally {
    loading.value = false;
  }
}

function showDetail(row: SaleOrderDto) {
  detail.value = row;
  detailVisible.value = true;
}

function itemCount(row: SaleOrderDto): number {
  return row.items.reduce((n, i) => n + i.qty, 0);
}

function payLabels(row: SaleOrderDto): string {
  return row.payments.map((p) => PAYMENT_METHOD_LABELS[p.method]).join(' + ');
}

async function doVoid(row: SaleOrderDto) {
  const { value } = await ElMessageBox.prompt('作废将回补未退库存，且不可恢复。请输入作废原因：', '整单作废', {
    confirmButtonText: '作废',
    cancelButtonText: '取消',
    inputPattern: /^.{2,}$/,
    inputErrorMessage: '原因至少 2 个字',
  });
  await voidOrder(row.id, value);
  ElMessage.success('已作废');
  await load();
}

onMounted(load);
</script>

<template>
  <el-card>
    <div class="toolbar">
      <el-input
        v-model="keyword"
        placeholder="按单号前缀查询（如 S20261023）"
        style="width: 260px"
        clearable
        @keyup.enter="() => { page = 1; load(); }"
      />
      <el-button type="primary" @click="() => { page = 1; load(); }">查询</el-button>
    </div>
    <el-table v-loading="loading" :data="items" stripe>
      <el-table-column label="单号" prop="orderNo" width="180" />
      <el-table-column label="时间" width="160">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="收银员" prop="cashierName" width="110" />
      <el-table-column label="件数" width="70" align="center">
        <template #default="{ row }">{{ itemCount(row) }}</template>
      </el-table-column>
      <el-table-column label="金额" width="110" align="right">
        <template #default="{ row }">¥{{ fenToYuan(row.payableAmount) }}</template>
      </el-table-column>
      <el-table-column label="支付方式" min-width="140">
        <template #default="{ row }">{{ payLabels(row) }}</template>
      </el-table-column>
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="row.status === 'NORMAL' ? 'success' : 'danger'">
            {{ row.status === 'NORMAL' ? '正常' : '已作废' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column width="200" align="center">
        <template #default="{ row }">
          <el-button size="small" @click="showDetail(row)">详情</el-button>
          <el-button v-if="auth.isBoss && row.status === 'NORMAL'" size="small" type="danger" plain @click="doVoid(row)">
            作废
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="page"
      :page-size="pageSize"
      :total="total"
      layout="total, prev, pager, next"
      style="margin-top: 12px; justify-content: flex-end"
      @current-change="load"
    />
  </el-card>

  <el-dialog v-model="detailVisible" :title="`订单详情 ${detail?.orderNo ?? ''}`" width="560px">
    <template v-if="detail">
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="时间">{{ formatDateTime(detail.createdAt) }}</el-descriptions-item>
        <el-descriptions-item label="收银员">{{ detail.cashierName }}</el-descriptions-item>
        <el-descriptions-item v-if="detail.voidReason" label="作废原因" :span="2">{{ detail.voidReason }}</el-descriptions-item>
      </el-descriptions>
      <el-table :data="detail.items" size="small" style="margin-top: 10px">
        <el-table-column label="商品">
          <template #default="{ row }">{{ row.productName }}{{ row.spec ? ` ${row.spec}` : '' }}</template>
        </el-table-column>
        <el-table-column label="单价" width="90" align="right">
          <template #default="{ row }">{{ fenToYuan(row.unitPrice) }}</template>
        </el-table-column>
        <el-table-column label="数量" width="70" align="center">
          <template #default="{ row }">{{ row.qty }}</template>
        </el-table-column>
        <el-table-column label="小计" width="90" align="right">
          <template #default="{ row }">{{ fenToYuan(row.subtotal) }}</template>
        </el-table-column>
        <el-table-column label="已退" width="70" align="center">
          <template #default="{ row }">{{ row.refundedQty || '-' }}</template>
        </el-table-column>
      </el-table>
      <div style="text-align: right; margin-top: 10px; font-size: 16px">
        实收：<b style="color: #eb3b5a">¥{{ fenToYuan(detail.payableAmount) }}</b>
      </div>
    </template>
  </el-dialog>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
</style>
