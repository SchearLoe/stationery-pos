<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { SaleOrderDto } from '@pos/shared-types';
import { createRefund, getOrderByNo } from '@/api';
import { fenToYuan, formatDateTime } from '@/utils/money';
import { useSettingsStore } from '@/stores/settings';

const settings = useSettingsStore();
const orderNo = ref('');
const order = ref<SaleOrderDto | null>(null);
const refundQty = ref<Record<string, number>>({});
const reason = ref('');
const submitting = ref(false);

async function query() {
  const no = orderNo.value.trim();
  if (!no) return;
  try {
    order.value = await getOrderByNo(no);
    refundQty.value = {};
  } catch {
    order.value = null;
  }
}

function maxRefundable(qty: number, refunded: number) {
  return qty - refunded;
}

function refundTotal(): number {
  if (!order.value) return 0;
  return order.value.items.reduce((sum, item) => sum + (refundQty.value[item.id] ?? 0) * item.unitPrice, 0);
}

const canSubmit = () =>
  !!order.value && refundTotal() > 0 && reason.value.trim().length >= 2;

async function submit() {
  if (!order.value || !canSubmit()) return;
  submitting.value = true;
  try {
    await createRefund({
      orderId: order.value.id,
      reason: reason.value.trim(),
      items: Object.entries(refundQty.value)
        .filter(([, qty]) => qty > 0)
        .map(([saleItemId, qty]) => ({ saleItemId, qty })),
    });
    ElMessage.success(`退货成功，应退现金 ¥${fenToYuan(refundTotal())}`);
    order.value = null;
    orderNo.value = '';
    reason.value = '';
  } catch {
    // 拦截器提示
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <el-card>
    <div class="toolbar">
      <el-input
        v-model="orderNo"
        placeholder="输入销售单号（小票上的 S 开头单号，支持扫码）"
        style="width: 320px"
        clearable
        @keyup.enter="query"
      />
      <el-button type="primary" @click="query">查询</el-button>
    </div>

    <template v-if="order">
      <el-alert
        v-if="order.status === 'VOID'"
        title="该订单已作废，无法退货"
        type="error"
        :closable="false"
        style="margin-bottom: 12px"
      />
      <template v-else>
        <el-descriptions :column="3" border size="small" style="margin-bottom: 12px">
          <el-descriptions-item label="单号">{{ order.orderNo }}</el-descriptions-item>
          <el-descriptions-item label="时间">{{ formatDateTime(order.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="实收">¥{{ fenToYuan(order.payableAmount) }}</el-descriptions-item>
        </el-descriptions>
        <el-table :data="order.items" border size="small">
          <el-table-column label="商品">
            <template #default="{ row }">{{ row.productName }}{{ row.spec ? ` ${row.spec}` : '' }}</template>
          </el-table-column>
          <el-table-column label="单价" width="90" align="right">
            <template #default="{ row }">{{ fenToYuan(row.unitPrice) }}</template>
          </el-table-column>
          <el-table-column label="购买" width="70" align="center" prop="qty" />
          <el-table-column label="已退" width="70" align="center">
            <template #default="{ row }">{{ row.refundedQty }}</template>
          </el-table-column>
          <el-table-column label="本次退货数" width="180" align="center">
            <template #default="{ row }">
              <el-input-number
                v-model="refundQty[row.id]"
                :min="0"
                :max="maxRefundable(row.qty, row.refundedQty)"
                size="small"
                :disabled="maxRefundable(row.qty, row.refundedQty) === 0"
              />
            </template>
          </el-table-column>
        </el-table>
        <div class="refund-bottom">
          <el-input v-model="reason" placeholder="退货原因（必填）" style="width: 280px" />
          <div class="refund-total">
            应退：<b style="color: #eb3b5a; font-size: 20px">¥{{ fenToYuan(refundTotal()) }}</b>
          </div>
          <el-button type="danger" size="large" :loading="submitting" :disabled="!canSubmit()" @click="submit">
            确认退货
          </el-button>
        </div>
      </template>
    </template>
    <el-empty v-else description="输入销售单号查询后退货" />
  </el-card>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 14px;
}
.refund-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
  gap: 12px;
}
</style>
