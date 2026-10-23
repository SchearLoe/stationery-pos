<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import type { CategoryDto, ProductDto, ProductUpsertInput, SkuUpsertInput } from '@pos/shared-types';
import {
  createCategory,
  createProduct,
  deleteCategory,
  importProducts,
  listCategories,
  listProducts,
  updateCategory,
  updateProduct,
} from '@/api';
import { fenToYuan, yuanToFen } from '@/utils/money';

// ---------- 列表 ----------
const items = ref<ProductDto[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const keyword = ref('');
const categoryId = ref('');
const loading = ref(false);
const categories = ref<CategoryDto[]>([]);

async function load() {
  loading.value = true;
  try {
    const result = await listProducts({
      page: page.value,
      pageSize,
      keyword: keyword.value || undefined,
      categoryId: categoryId.value || undefined,
    });
    items.value = result.items;
    total.value = result.total;
  } finally {
    loading.value = false;
  }
}

async function loadCategories() {
  categories.value = await listCategories();
}

onMounted(() => {
  void load();
  void loadCategories();
});

// ---------- 商品编辑 ----------
const editVisible = ref(false);
const editForm = ref<ProductUpsertInput>(emptyProduct());
const editSkus = ref<SkuUpsertInput[]>([]);
const saving = ref(false);

function emptyProduct(): ProductUpsertInput {
  return { name: '', brand: '', categoryId: '', unit: '件', skus: [] };
}

function openCreate() {
  editForm.value = emptyProduct();
  editSkus.value = [newSku()];
  editVisible.value = true;
}

function newSku(): SkuUpsertInput {
  return { barcode: '', spec: '', retailPrice: 0, memberPrice: null, minPrice: null, cost: null, safetyStock: 0, initQty: 0 };
}

function openEdit(p: ProductDto) {
  editForm.value = {
    id: p.id,
    name: p.name,
    brand: p.brand ?? '',
    categoryId: p.categoryId ?? '',
    unit: p.unit,
    status: p.status,
    remark: p.remark ?? '',
    skus: [],
  };
  editSkus.value = p.skus.map((s) => ({
    id: s.id,
    barcode: s.barcode ?? '',
    spec: s.spec ?? '',
    retailPrice: s.retailPrice,
    memberPrice: s.memberPrice,
    minPrice: s.minPrice,
    cost: s.lastCost ?? null,
    safetyStock: s.safetyStock,
  }));
  editVisible.value = true;
}

async function save() {
  if (!editForm.value.name.trim()) {
    ElMessage.warning('请填写商品名称');
    return;
  }
  const skus = editSkus.value.filter((s) => s.retailPrice > 0 || s.id);
  if (skus.length === 0) {
    ElMessage.warning('请至少填写一个 SKU 的售价');
    return;
  }
  saving.value = true;
  try {
    const payload: ProductUpsertInput = {
      ...editForm.value,
      categoryId: editForm.value.categoryId || null,
      brand: editForm.value.brand || null,
      remark: editForm.value.remark || null,
      skus: skus.map((s) => ({
        ...s,
        barcode: s.barcode || null,
        spec: s.spec || null,
      })),
    };
    if (payload.id) await updateProduct(payload.id, payload);
    else await createProduct(payload);
    ElMessage.success('保存成功');
    editVisible.value = false;
    await load();
  } catch {
    // 拦截器提示
  } finally {
    saving.value = false;
  }
}

async function toggleStatus(p: ProductDto) {
  const next = p.status === 'ON_SALE' ? 'OFF_SALE' : 'ON_SALE';
  await updateProduct(p.id, {
    name: p.name,
    brand: p.brand,
    categoryId: p.categoryId,
    unit: p.unit,
    status: next,
    skus: p.skus.map((s) => ({
      id: s.id,
      barcode: s.barcode,
      spec: s.spec,
      retailPrice: s.retailPrice,
      memberPrice: s.memberPrice,
      minPrice: s.minPrice,
      safetyStock: s.safetyStock,
    })),
  });
  ElMessage.success(next === 'ON_SALE' ? '已上架' : '已停售');
  await load();
}

// ---------- 类目 ----------
const catVisible = ref(false);
const newCatName = ref('');

async function addCat() {
  if (!newCatName.value.trim()) return;
  await createCategory({ name: newCatName.value.trim() });
  newCatName.value = '';
  await loadCategories();
}

async function renameCat(c: CategoryDto) {
  const { value } = await ElMessageBox.prompt('修改分类名', '提示', { inputValue: c.name });
  await updateCategory(c.id, { name: value });
  await loadCategories();
}

async function removeCat(c: CategoryDto) {
  await ElMessageBox.confirm(`确定删除分类「${c.name}」？`, '提示', { type: 'warning' });
  await deleteCategory(c.id);
  await loadCategories();
}

// ---------- CSV 导入 ----------
const importVisible = ref(false);
const importRows = ref<Record<string, string>[]>([]);
const importFileRef = ref<HTMLInputElement | null>(null);

function openImport() {
  importRows.value = [];
  importVisible.value = true;
}

function pickFile() {
  importFileRef.value?.click();
}

async function onFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    ElMessage.warning('CSV 为空或只有表头');
    return;
  }
  const headers = lines[0]!.split(',').map((h) => h.trim());
  importRows.value = lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Record<string, string> = {};
    headers.forEach((h, i) => (row[h] = (cells[i] ?? '').trim()));
    return row;
  });
  ElMessage.success(`解析到 ${importRows.value.length} 行`);
}

async function doImport() {
  if (importRows.value.length === 0) return;
  const rows = importRows.value.map((r) => ({
    categoryName: r['类目'] ?? '',
    productName: r['商品名'] ?? '',
    brand: r['品牌'] ?? '',
    unit: r['单位'] ?? '件',
    spec: r['规格'] ?? '',
    barcode: r['条码'] || undefined,
    cost: r['进价(元)'] || undefined,
    retailPrice: r['售价(元)'] ?? '0',
    memberPrice: r['会员价(元)'] || undefined,
    qty: r['期初库存'] || '0',
    safetyStock: r['安全库存'] || '0',
  }));
  const result = await importProducts(rows, true);
  const failed = result.errors.length;
  ElMessage({
    type: failed ? 'warning' : 'success',
    message: `导入完成：新建商品 ${result.createdProducts}、SKU ${result.createdSkus}，跳过 ${result.skipped}，失败 ${failed}`,
    duration: 6000,
  });
  if (failed) console.warn('导入失败明细', result.errors);
  importVisible.value = false;
  await load();
}
</script>

<template>
  <el-card>
    <div class="toolbar">
      <el-input
        v-model="keyword"
        placeholder="商品名 / 品牌 / 条码"
        style="width: 240px"
        clearable
        @keyup.enter="() => { page = 1; load(); }"
      />
      <el-select v-model="categoryId" placeholder="全部分类" style="width: 160px" clearable @change="() => { page = 1; load(); }">
        <el-option v-for="c in categories" :key="c.id" :value="c.id" :label="c.name" />
      </el-select>
      <el-button type="primary" @click="() => { page = 1; load(); }">查询</el-button>
      <div class="spacer" />
      <el-button @click="catVisible = true">分类管理</el-button>
      <el-button @click="openImport">CSV 导入</el-button>
      <el-button type="primary" @click="openCreate">新增商品</el-button>
    </div>

    <el-table v-loading="loading" :data="items" stripe>
      <el-table-column label="商品" min-width="200">
        <template #default="{ row }">
          <b>{{ row.name }}</b>
          <div v-if="row.brand" class="sub">{{ row.brand }}</div>
        </template>
      </el-table-column>
      <el-table-column label="分类" width="100">
        <template #default="{ row }">{{ row.categoryName ?? '-' }}</template>
      </el-table-column>
      <el-table-column label="规格 / 条码 / 价格 / 库存" min-width="330">
        <template #default="{ row }">
          <div v-for="s in row.skus" :key="s.id" class="sku-line">
            <span class="sku-spec">{{ s.spec ?? '-' }}</span>
            <span class="sku-bc">{{ s.barcode ?? '无码' }}</span>
            <span class="sku-price">¥{{ fenToYuan(s.retailPrice) }}</span>
            <span class="sku-cost">进 ¥{{ fenToYuan(s.lastCost ?? 0) }}</span>
            <el-tag size="small" :type="(s.qty ?? 0) <= s.safetyStock ? 'danger' : 'info'">库 {{ s.qty ?? 0 }}</el-tag>
            <el-tag v-if="s.status === 'OFF_SALE'" size="small" type="warning">停售</el-tag>
          </div>
        </template>
      </el-table-column>
      <el-table-column width="170" align="center">
        <template #default="{ row }">
          <el-button size="small" @click="openEdit(row)">编辑</el-button>
          <el-button size="small" :type="row.status === 'ON_SALE' ? 'warning' : 'success'" plain @click="toggleStatus(row)">
            {{ row.status === 'ON_SALE' ? '停售' : '上架' }}
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

  <!-- 商品编辑 -->
  <el-dialog v-model="editVisible" :title="editForm.id ? '编辑商品' : '新增商品'" width="860px" top="4vh">
    <el-form :model="editForm" label-width="70px">
      <div class="form-grid">
        <el-form-item label="名称" required>
          <el-input v-model="editForm.name" placeholder="如：晨光中性笔 K35" />
        </el-form-item>
        <el-form-item label="品牌">
          <el-input v-model="editForm.brand" />
        </el-form-item>
        <el-form-item label="分类">
          <el-select v-model="editForm.categoryId" clearable placeholder="选择分类" style="width: 100%">
            <el-option v-for="c in categories" :key="c.id" :value="c.id" :label="c.name" />
          </el-select>
        </el-form-item>
        <el-form-item label="单位">
          <el-input v-model="editForm.unit" style="width: 100px" placeholder="支/本/盒" />
        </el-form-item>
      </div>
    </el-form>

    <div class="sku-header">
      <b>SKU（规格 / 条码 / 价格 / 库存）</b>
      <el-button size="small" @click="editSkus.push(newSku())">+ 添加规格</el-button>
    </div>
    <el-table :data="editSkus" size="small" border>
      <el-table-column label="规格" min-width="120">
        <template #default="{ row }">
          <el-input v-model="row.spec" placeholder="黑色 0.5mm" size="small" />
        </template>
      </el-table-column>
      <el-table-column label="条码" min-width="140">
        <template #default="{ row }">
          <el-input v-model="row.barcode" placeholder="扫码录入，留空自动生成" size="small" />
        </template>
      </el-table-column>
      <el-table-column label="售价(元)" width="110">
        <template #default="{ row }">
          <el-input :model-value="row.retailPrice ? fenToYuan(row.retailPrice) : ''" size="small" @update:model-value="row.retailPrice = yuanToFen($event)" />
        </template>
      </el-table-column>
      <el-table-column label="进价(元)" width="110">
        <template #default="{ row }">
          <el-input :model-value="row.cost != null ? fenToYuan(row.cost) : ''" size="small" @update:model-value="row.cost = $event === '' ? null : yuanToFen($event)" />
        </template>
      </el-table-column>
      <el-table-column label="最低价(元)" width="110">
        <template #default="{ row }">
          <el-input :model-value="row.minPrice != null ? fenToYuan(row.minPrice) : ''" size="small" placeholder="不限" @update:model-value="row.minPrice = $event === '' ? null : yuanToFen($event)" />
        </template>
      </el-table-column>
      <el-table-column label="安全库存" width="100">
        <template #default="{ row }">
          <el-input-number v-model="row.safetyStock" :min="0" size="small" controls-position="hidden" style="width: 76px" />
        </template>
      </el-table-column>
      <el-table-column v-if="!editForm.id" label="期初库存" width="100">
        <template #default="{ row }">
          <el-input-number v-model="row.initQty" :min="0" size="small" controls-position="hidden" style="width: 76px" />
        </template>
      </el-table-column>
      <el-table-column width="60" align="center">
        <template #default="{ $index }">
          <el-button size="small" type="danger" text :disabled="editSkus.length <= 1" @click="editSkus.splice($index, 1)">删</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="tip">提示：编辑时删除某规格行 = 停售该规格（保留历史单据）；条码可用扫码枪直接录入</div>
    <template #footer>
      <el-button @click="editVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>

  <!-- 分类管理 -->
  <el-dialog v-model="catVisible" title="分类管理" width="420px">
    <div class="cat-add">
      <el-input v-model="newCatName" placeholder="新分类名称" @keyup.enter="addCat" />
      <el-button type="primary" @click="addCat">添加</el-button>
    </div>
    <div v-for="c in categories" :key="c.id" class="cat-item">
      <span>{{ c.name }}</span>
      <span>
        <el-button size="small" text @click="renameCat(c)">改名</el-button>
        <el-button size="small" text type="danger" @click="removeCat(c)">删除</el-button>
      </span>
    </div>
  </el-dialog>

  <!-- CSV 导入 -->
  <el-dialog v-model="importVisible" title="CSV 批量导入" width="520px">
    <ol class="import-steps">
      <li>用 Excel/WPS 准备 UTF-8 编码的 CSV，表头为：<code>类目,商品名,品牌,单位,规格,条码,进价(元),售价(元),期初库存,安全库存</code></li>
      <li>无条码的商品留空，系统自动生成店内码</li>
      <li>条码已存在或（同名同规格）已导入的行会自动跳过，不会重复入库</li>
    </ol>
    <input ref="importFileRef" type="file" accept=".csv,text/csv" style="display: none" @change="onFileChange" />
    <el-button type="primary" plain @click="pickFile">选择 CSV 文件</el-button>
    <el-alert
      v-if="importRows.length"
      :title="`已解析 ${importRows.length} 行，确认导入`"
      type="success"
      :closable="false"
      style="margin-top: 10px"
    />
    <template #footer>
      <el-button @click="importVisible = false">取消</el-button>
      <el-button type="primary" :disabled="importRows.length === 0" @click="doImport">开始导入</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.toolbar {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
  align-items: center;
}
.spacer {
  flex: 1;
}
.sub {
  color: #a4b0be;
  font-size: 12px;
}
.sku-line {
  display: flex;
  gap: 10px;
  align-items: center;
  line-height: 22px;
}
.sku-spec {
  min-width: 90px;
}
.sku-bc {
  color: #a4b0be;
  font-size: 12px;
  min-width: 110px;
}
.sku-price {
  color: #eb3b5a;
  font-weight: 600;
  min-width: 56px;
}
.sku-cost {
  color: #a4b0be;
  font-size: 12px;
  min-width: 64px;
}
.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 12px;
}
.sku-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 8px 0;
}
.tip {
  color: #a4b0be;
  font-size: 12px;
  margin-top: 8px;
}
.cat-add {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}
.cat-item {
  display: flex;
  justify-content: space-between;
  padding: 6px 4px;
  border-bottom: 1px solid #f1f2f6;
}
.import-steps {
  color: #57606f;
  font-size: 13px;
  padding-left: 18px;
  margin: 0 0 12px;
}
.import-steps code {
  background: #f1f2f6;
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 12px;
}
</style>
