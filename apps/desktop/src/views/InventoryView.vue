<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { INVENTORY_CHANGE_LABELS } from '@pos/shared-types';
import type { InventoryChangeType } from '@pos/shared-types';
import { adjustInventory, listInventory, listInventoryLogs } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { fenToYuan, formatDateTime } from '@/utils/money';

const auth = useAuthStore();
const activeTab = ref('stock');

// 库存列表
const stockItems = ref<Awaited<ReturnType<typeof listInventory>>['items']>([]);
const stockTotal = ref(0);
const page = ref(1);
const pageSize = 50;
const keyword = ref('');
const lowOnly = ref(false);
const loading = ref(false);

async function loadStock() {
  loading.value = true;
  try {
    const result = await listInventory({
      page: page.value,
      pageSize,
      keyword: keyword.value || undefined,
      lowStock: lowOnly.value ? 'true' : undefined,
    });
    stockItems.value = result.items;
    stockTotal.value = result.total;
  } finally {
    loading.value = false;
  }
}

// 调整库存
const adjustVisible = ref(false);
const adjustTarget = ref<{ skuId: string; productName: string; spec: unknown; qty: number } | null>(null);
const adjustQty = ref(0);
const adjustNote = ref('');

function openAdjust(row: (typeof stockItems.value)[number]) {
  adjustTarget.value = { skuId: row.skuId, productName: row.productName, spec: row.spec, qty: row.qty };
  adjustQty.value = row.qty;
  adjustNote.value = '';
  adjustVisible.value = true;
}

async function doAdjust() {
  if (!adjustTarget.value) return;
  await adjustInventory({
    skuId: adjustTarget.value.skuId,
    actualQty: adjustQty.value,
    note: adjustNote.value || undefined,
  });
  ElMessage.success('库存已调整');
  adjustVisible.value = false;
  await loadStock();
}

// 库存流水
const logItems = ref<Awaited<ReturnType<typeof listInventoryLogs>>['items']>([]);
const logTotal = ref(0);
const logPage = ref(1);
const logType = ref('');

async function loadLogs() {
  const result = await listInventoryLogs({
    page: logPage.value,
    pageSize: 50,
    type: logType.value || undefined,
  });
  logItems.value = result.items;
  logTotal.value = result.total;
}

onMounted(() => {
  void loadStock();
  void loadLogs();
});
</script>

<template>
  <el-card>
    <el-tabs v-model="activeTab">
      <el-tab-pane label="库存查询" name="stock">
        <div class="toolbar">
          <el-input
            v-model="keyword"
            placeholder="商品名 / 条码"
            style="width: 220px"
            clearable
            @keyup.enter="() => { page = 1; loadStock(); }"
          />
          <el-checkbox v-model="lowOnly" @change="() => { page = 1; loadStock(); }">只看低库存</el-checkbox>
          <el-button type="primary" @click="() => { page = 1; loadStock(); }">查询</el-button>
        </div>
        <el-table v-loading="loading" :data="stockItems" stripe size="small">
          <el-table-column label="商品" min-width="200">
            <template #default="{ row }">
              {{ row.productName }}<span v-if="row.spec" class="sub"> {{ row.spec }}</span>
            </template>
          </el-table-column>
          <el-table-column label="条码" prop="barcode" width="140" />
          <el-table-column label="库存" width="90" align="center">
            <template #default="{ row }">
              <b :style="{ color: row.low ? '#eb3b5a' : '#2f3542' }">{{ row.qty }}</b>
            </template>
          </el-table-column>
          <el-table-column label="安全库存" prop="safetyStock" width="90" align="center" />
          <el-table-column label="售价" width="90" align="right">
            <template #default="{ row }">¥{{ fenToYuan(row.retailPrice) }}</template>
          </el-table-column>
          <el-table-column v-if="auth.isBoss" label="成本(均价)" width="100" align="right">
            <template #default="{ row }">{{ row.costAvg != null ? `¥${fenToYuan(row.costAvg)}` : '-' }}</template>
          </el-table-column>
          <el-table-column width="110" align="center">
            <template #default="{ row }">
              <el-button v-if="auth.isBoss" size="small" @click="openAdjust(row)">调整</el-button>
            </template>
          </el-table-column>
        </el-table>
        <el-pagination
          v-model:current-page="page"
          :page-size="pageSize"
          :total="stockTotal"
          layout="total, prev, pager, next"
          style="margin-top: 12px; justify-content: flex-end"
          @current-change="loadStock"
        />
      </el-tab-pane>

      <el-tab-pane label="库存流水" name="logs">
        <div class="toolbar">
          <el-select v-model="logType" placeholder="全部类型" clearable style="width: 160px" @change="() => { logPage = 1; loadLogs(); }">
            <el-option v-for="(label, t) in INVENTORY_CHANGE_LABELS" :key="t" :value="t" :label="label" />
          </el-select>
          <el-button @click="loadLogs()">刷新</el-button>
        </div>
        <el-table :data="logItems" stripe size="small">
          <el-table-column label="时间" width="160">
            <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column label="商品" min-width="180">
            <template #default="{ row }">{{ row.productName }}<span v-if="row.spec" class="sub"> {{ row.spec }}</span></template>
          </el-table-column>
          <el-table-column label="类型" width="100" align="center">
            <template #default="{ row }">{{ INVENTORY_CHANGE_LABELS[row.type as InventoryChangeType] }}</template>
          </el-table-column>
          <el-table-column label="变动" width="80" align="center">
            <template #default="{ row }">
              <span :style="{ color: row.change > 0 ? '#20bf6b' : '#eb3b5a' }">{{ row.change > 0 ? '+' : '' }}{{ row.change }}</span>
            </template>
          </el-table-column>
          <el-table-column label="结存" width="80" align="center" prop="after" />
          <el-table-column label="关联单号" prop="refNo" width="170">
            <template #default="{ row }">{{ row.refNo ?? '-' }}</template>
          </el-table-column>
          <el-table-column label="操作人" prop="operatorName" width="100" />
          <el-table-column label="备注" prop="note" min-width="140" />
        </el-table>
        <el-pagination
          v-model:current-page="logPage"
          :page-size="50"
          :total="logTotal"
          layout="total, prev, pager, next"
          style="margin-top: 12px; justify-content: flex-end"
          @current-change="loadLogs"
        />
      </el-tab-pane>
    </el-tabs>
  </el-card>

  <el-dialog v-model="adjustVisible" title="调整库存（盘点/报损）" width="400px">
    <div v-if="adjustTarget">
      <p>{{ adjustTarget.productName }} {{ adjustTarget.spec ?? '' }}　当前库存 <b>{{ adjustTarget.qty }}</b></p>
      <el-form label-width="80px">
        <el-form-item label="实际库存">
          <el-input-number v-model="adjustQty" :min="0" size="large" />
        </el-form-item>
        <el-form-item label="原因">
          <el-input v-model="adjustNote" placeholder="如：盘点差异 / 破损报损" />
        </el-form-item>
      </el-form>
    </div>
    <template #footer>
      <el-button @click="adjustVisible = false">取消</el-button>
      <el-button type="primary" @click="doAdjust">确认调整</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}
.sub {
  color: #a4b0be;
  font-size: 12px;
}
</style>
