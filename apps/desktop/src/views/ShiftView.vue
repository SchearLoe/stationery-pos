<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { PAYMENT_METHOD_LABELS } from '@pos/shared-types';
import type { PaymentMethod } from '@pos/shared-types';
import { closeShift, currentShift, listShifts, openShift } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { fenToYuan, formatDateTime } from '@/utils/money';

const auth = useAuthStore();
const shift = ref<Awaited<ReturnType<typeof currentShift>>>(null);
const history = ref<Awaited<ReturnType<typeof listShifts>>['items']>([]);
const historyTotal = ref(0);

const closeVisible = ref(false);
const countedCash = ref('');
const closeNote = ref('');
const submitting = ref(false);

const expectedCash = computed(
  () => shift.value?.summary?.find((s) => s.method === 'CASH')?.amount ?? 0,
);

async function load() {
  shift.value = await currentShift();
  const result = await listShifts({ page: 1, pageSize: 20, mine: auth.isBoss ? undefined : 'true' });
  history.value = result.items;
  historyTotal.value = result.total;
}

async function doOpen() {
  await openShift();
  ElMessage.success('班次已开始');
  await load();
}

function openClose() {
  countedCash.value = fenToYuan(expectedCash.value);
  closeVisible.value = true;
}

async function doClose() {
  const counted = Math.round(Number(countedCash.value) * 100);
  if (Number.isNaN(counted) || counted < 0) {
    ElMessage.warning('请输入正确的实点现金金额');
    return;
  }
  submitting.value = true;
  try {
    await closeShift(counted, closeNote.value || undefined);
    ElMessage.success(
      `班次已结束。应收现金 ¥${fenToYuan(expectedCash.value)}，差异 ¥${fenToYuan(counted - expectedCash.value)}`,
    );
    closeVisible.value = false;
    await load();
  } catch {
    // 拦截器提示
  } finally {
    submitting.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <el-card>
      <template #header>当前班次</template>
      <template v-if="shift">
        <el-descriptions :column="3" border>
          <el-descriptions-item label="开始时间">{{ formatDateTime(shift.openedAt) }}</el-descriptions-item>
          <el-descriptions-item label="订单数">{{ shift.orderCount ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="销售额">
            ¥{{ fenToYuan(shift.total ?? 0) }}（退 ¥{{ fenToYuan(shift.refundAmount ?? 0) }}）
          </el-descriptions-item>
        </el-descriptions>
        <el-table :data="shift.summary ?? []" size="small" style="margin-top: 12px; max-width: 480px">
          <el-table-column label="支付方式" width="120">
            <template #default="{ row }">{{ PAYMENT_METHOD_LABELS[row.method as PaymentMethod] }}</template>
          </el-table-column>
          <el-table-column label="笔数" width="90" align="center" prop="count" />
          <el-table-column label="净额" align="right">
            <template #default="{ row }">¥{{ fenToYuan(row.amount) }}</template>
          </el-table-column>
        </el-table>
        <div style="margin-top: 16px">
          <el-button type="danger" size="large" @click="openClose">结束班次（交接）</el-button>
        </div>
      </template>
      <el-empty v-else description="当前没有进行中的班次">
        <el-button type="primary" size="large" @click="doOpen">开始班次</el-button>
      </el-empty>
    </el-card>

    <el-card style="margin-top: 14px">
      <template #header>班次历史（最近 20 条）</template>
      <el-table :data="history" stripe size="small">
        <el-table-column label="收银员" prop="cashierName" width="110" />
        <el-table-column label="开始" width="160">
          <template #default="{ row }">{{ formatDateTime(row.openedAt) }}</template>
        </el-table-column>
        <el-table-column label="结束" width="160">
          <template #default="{ row }">{{ row.closedAt ? formatDateTime(row.closedAt) : '-' }}</template>
        </el-table-column>
        <el-table-column label="应收现金" width="110" align="right">
          <template #default="{ row }">{{ row.expectedCash != null ? `¥${fenToYuan(row.expectedCash)}` : '-' }}</template>
        </el-table-column>
        <el-table-column label="实点现金" width="110" align="right">
          <template #default="{ row }">{{ row.countedCash != null ? `¥${fenToYuan(row.countedCash)}` : '-' }}</template>
        </el-table-column>
        <el-table-column label="差异" width="110" align="right">
          <template #default="{ row }">
            <span v-if="row.diff != null" :style="{ color: row.diff === 0 ? '#20bf6b' : '#eb3b5a' }">
              {{ row.diff > 0 ? '+' : '' }}{{ fenToYuan(row.diff) }}
            </span>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90" align="center">
          <template #default="{ row }">
            <el-tag :type="row.status === 'OPEN' ? 'success' : 'info'" size="small">
              {{ row.status === 'OPEN' ? '进行中' : '已结束' }}
            </el-tag>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="closeVisible" title="结束班次 / 交接" width="420px">
      <p>
        本班次应收现金：<b style="font-size: 18px">¥{{ fenToYuan(expectedCash) }}</b>
      </p>
      <el-form label-width="90px">
        <el-form-item label="实点现金">
          <el-input v-model="countedCash" size="large" @keyup.enter="doClose">
            <template #append>元</template>
          </el-input>
        </el-form-item>
        <el-form-item label="差异">
          <b :style="{ color: (Math.round(Number(countedCash) * 100) || 0) - expectedCash === 0 ? '#20bf6b' : '#eb3b5a' }">
            {{ fenToYuan((Math.round(Number(countedCash) * 100) || 0) - expectedCash) }} 元
          </b>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="closeNote" placeholder="如：短款 1 元原因" />
        </el-form-item>
      </el-form>
      <el-alert type="warning" :closable="false" title="结束班次后请清点钱箱并打印交接单留档（打印功能即将上线）" />
      <template #footer>
        <el-button @click="closeVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="doClose">确认结束</el-button>
      </template>
    </el-dialog>
  </div>
</template>
