<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Search } from '@element-plus/icons-vue';
import { STOCKTAKE_STATUS_LABELS } from '@pos/shared-types';
import type { CategoryDto, StocktakeTaskDto } from '@pos/shared-types';
import {
  applyStocktake,
  cancelStocktake,
  createStocktake,
  getStocktake,
  listCategories,
  listStocktakes,
  saveStocktakeCounts,
} from '@/api';
import { formatDateTime } from '@/utils/money';

// ---------- 任务列表 ----------

const tasks = ref<StocktakeTaskDto[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const statusFilter = ref('');

async function load() {
  loading.value = true;
  try {
    const res = await listStocktakes({
      page: page.value,
      pageSize: pageSize.value,
      ...(statusFilter.value ? { status: statusFilter.value } : {}),
    });
    tasks.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

// ---------- 新建任务 ----------

const categories = ref<CategoryDto[]>([]);
const createVisible = ref(false);
const createCategoryId = ref('');
const createNote = ref('');

async function openCreate() {
  if (categories.value.length === 0) categories.value = await listCategories();
  createCategoryId.value = '';
  createNote.value = '';
  createVisible.value = true;
}

async function confirmCreate() {
  const task = await createStocktake({
    categoryId: createCategoryId.value || undefined,
    note: createNote.value || undefined,
  });
  ElMessage.success(`盘点任务 ${task.taskNo} 已创建（共 ${task.itemCount ?? 0} 个 SKU）`);
  createVisible.value = false;
  page.value = 1;
  void load();
  void openTask(task.id);
}

// ---------- 盘点录入 ----------

const taskVisible = ref(false);
const task = ref<StocktakeTaskDto | null>(null);
const onlyDiff = ref(false);
const onlyUncounted = ref(false);
const saving = ref(false);
/** 本地待保存的实盘数（itemId -> 数量/null），保存后清空 */
const dirtyCounts = new Map<string, number | null>();

async function openTask(id: string) {
  task.value = await getStocktake(id);
  onlyDiff.value = false;
  onlyUncounted.value = false;
  dirtyCounts.clear();
  taskVisible.value = true;
}

const filteredItems = computed(() => {
  const items = task.value?.items ?? [];
  if (onlyUncounted.value) return items.filter((i) => (dirtyCounts.has(i.id) ? dirtyCounts.get(i.id) === null : i.countedQty === null));
  if (onlyDiff.value) {
    return items.filter((i) => {
      const c = dirtyCounts.has(i.id) ? dirtyCounts.get(i.id) : i.countedQty;
      return c !== null && c !== i.snapshotQty;
    });
  }
  return items;
});

function displayCount(i: { id: string; countedQty: number | null }): number | null | undefined {
  return dirtyCounts.has(i.id) ? dirtyCounts.get(i.id) : i.countedQty;
}

function setCount(id: string, v: number | null | undefined) {
  dirtyCounts.set(id, v === undefined ? null : v);
}

async function saveProgress() {
  if (!task.value || dirtyCounts.size === 0) {
    ElMessage.info('没有修改需要保存');
    return;
  }
  saving.value = true;
  try {
    task.value = await saveStocktakeCounts(
      task.value.id,
      [...dirtyCounts.entries()].map(([id, countedQty]) => ({ id, countedQty })),
    );
    dirtyCounts.clear();
    ElMessage.success(`已保存（累计已盘 ${task.value.countedCount}/${task.value.itemCount}）`);
  } finally {
    saving.value = false;
  }
}

async function doApply() {
  const t = task.value;
  if (!t) return;
  if (dirtyCounts.size > 0) {
    ElMessage.warning('有未保存的实盘数，请先保存');
    return;
  }
  await ElMessageBox.confirm(
    `将按实盘数生成库存调整（差异 ${t.diffCount} 项），应用后任务关闭。未盘项保持账面数不变。`,
    '应用盘点差异',
    { type: 'warning', confirmButtonText: '应用' },
  );
  task.value = await applyStocktake(t.id);
  ElMessage.success('盘点差异已应用');
  void load();
}

async function doCancel() {
  const t = task.value;
  if (!t) return;
  await ElMessageBox.confirm('确定取消该盘点任务？（已录入的实盘数将作废，不影响库存）', '取消任务', { type: 'warning' });
  task.value = await cancelStocktake(t.id);
  ElMessage.success('已取消');
  void load();
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-select v-model="statusFilter" placeholder="状态" clearable style="width: 120px" @change="page = 1; load()">
        <el-option v-for="(label, s) in STOCKTAKE_STATUS_LABELS" :key="s" :value="s" :label="label" />
      </el-select>
      <el-button :icon="Search" @click="page = 1; load()">查询</el-button>
      <div class="spacer" />
      <el-button type="primary" :icon="Plus" @click="openCreate">新建盘点任务</el-button>
    </div>

    <el-table v-loading="loading" :data="tasks" size="large">
      <el-table-column label="任务号" prop="taskNo" width="160" />
      <el-table-column label="状态" width="90" align="center">
        <template #default="{ row }">
          <el-tag :type="row.status === 'OPEN' ? 'warning' : row.status === 'APPLIED' ? 'success' : 'info'">
            {{ STOCKTAKE_STATUS_LABELS[row.status as keyof typeof STOCKTAKE_STATUS_LABELS] }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="范围" width="110" align="center">
        <template #default="{ row }">{{ row.scopeCategoryName ?? '全店' }}</template>
      </el-table-column>
      <el-table-column label="SKU 数" prop="itemCount" width="90" align="center" />
      <el-table-column label="已盘" width="90" align="center">
        <template #default="{ row }">{{ row.countedCount ?? 0 }} / {{ row.itemCount ?? 0 }}</template>
      </el-table-column>
      <el-table-column label="差异数" width="90" align="center">
        <template #default="{ row }">
          <span :class="{ 'diff-hot': (row.diffCount ?? 0) > 0 }">{{ row.diffCount ?? 0 }}</span>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="150">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="备注" prop="note" min-width="120" show-overflow-tooltip />
      <el-table-column label="操作" width="120" align="center">
        <template #default="{ row }">
          <el-button size="small" :type="row.status === 'OPEN' ? 'primary' : 'default'" @click="openTask(row.id)">
            {{ row.status === 'OPEN' ? '继续盘点' : '查看' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="page"
      :page-size="pageSize"
      :total="total"
      layout="total, prev, pager, next"
      class="pager"
      @current-change="load"
    />

    <!-- 新建 -->
    <el-dialog v-model="createVisible" title="新建盘点任务" width="440px">
      <el-alert type="info" :closable="false" title="创建时快照当前账面库存，之后逐项录入实盘数；应用差异时才真正调整库存" style="margin-bottom: 12px" />
      <el-form label-width="80px">
        <el-form-item label="盘点范围">
          <el-select v-model="createCategoryId" placeholder="全店" clearable style="width: 240px">
            <el-option v-for="c in categories" :key="c.id" :value="c.id" :label="c.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="createNote" placeholder="如：月度大盘 / 新年盘" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmCreate">创建并开始盘点</el-button>
      </template>
    </el-dialog>

    <!-- 盘点录入 -->
    <el-drawer v-model="taskVisible" :title="task ? `盘点 ${task.taskNo}` : ''" size="720px" :close-on-click-modal="false">
      <template v-if="task">
        <el-descriptions :column="3" border size="small" style="margin-bottom: 10px">
          <el-descriptions-item label="状态">
            <el-tag :type="task.status === 'OPEN' ? 'warning' : task.status === 'APPLIED' ? 'success' : 'info'" size="small">
              {{ STOCKTAKE_STATUS_LABELS[task.status] }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="范围">{{ task.scopeCategoryName ?? '全店' }}</el-descriptions-item>
          <el-descriptions-item label="进度">{{ task.countedCount }}/{{ task.itemCount }} 已盘 · {{ task.diffCount }} 差异</el-descriptions-item>
        </el-descriptions>

        <div class="toolbar">
          <el-checkbox v-model="onlyUncounted" :disabled="task.status !== 'OPEN'">只看未盘</el-checkbox>
          <el-checkbox v-model="onlyDiff" :disabled="task.status !== 'OPEN'">只看差异</el-checkbox>
          <div class="spacer" />
          <template v-if="task.status === 'OPEN'">
            <el-button :loading="saving" @click="saveProgress">保存进度</el-button>
            <el-button type="primary" @click="doApply">应用差异</el-button>
            <el-button type="danger" plain @click="doCancel">取消任务</el-button>
          </template>
        </div>

        <el-table :data="filteredItems" size="small" max-height="560">
          <el-table-column label="商品" min-width="170">
            <template #default="{ row }">
              {{ row.productName }} <span v-if="row.spec" class="spec">{{ row.spec }}</span>
            </template>
          </el-table-column>
          <el-table-column label="条码" prop="barcode" width="130" />
          <el-table-column label="账面数" prop="snapshotQty" width="80" align="center" />
          <el-table-column label="实盘数" width="140" align="center">
            <template #default="{ row }">
              <el-input-number
                v-if="task.status === 'OPEN'"
                :model-value="displayCount(row)"
                :min="0"
                :max="999999"
                size="small"
                controls-position="hidden"
                style="width: 90px"
                placeholder="未盘"
                @update:model-value="(v: number | undefined) => setCount(row.id, v ?? null)"
              />
              <span v-else>{{ row.countedQty ?? '—' }}</span>
            </template>
          </el-table-column>
          <el-table-column label="差异" width="80" align="center">
            <template #default="{ row }">
              <span v-if="displayCount(row) !== null && displayCount(row) !== undefined" :class="(displayCount(row) as number) - row.snapshotQty !== 0 ? 'diff-hot' : 'diff-zero'">
                {{ (displayCount(row) as number) - row.snapshotQty > 0 ? '+' : '' }}{{ (displayCount(row) as number) - row.snapshotQty }}
              </span>
              <span v-else class="spec">—</span>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </el-drawer>
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
  gap: 12px;
  align-items: center;
  margin-bottom: 10px;
}
.toolbar .spacer {
  flex: 1;
}
.pager {
  margin-top: 12px;
  justify-content: flex-end;
}
.spec {
  color: #a4b0be;
  font-size: 12px;
}
.diff-hot {
  color: #eb3b5a;
  font-weight: 600;
}
.diff-zero {
  color: #20bf6b;
}
</style>
