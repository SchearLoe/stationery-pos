<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Delete, Download, Plus } from '@element-plus/icons-vue';
import { EXPENSE_CATEGORY_LABELS } from '@pos/shared-types';
import type { ExpenseDto, MonthlyStatementDto } from '@pos/shared-types';
import {
  createExpense,
  deleteExpense,
  exportMonthlyCsv,
  listExpenses,
  monthlyStatement,
} from '@/api';
import { fenToYuan, yuanToFen, money, formatDateTime } from '@/utils/money';

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const month = ref(currentMonth());
const statement = ref<MonthlyStatementDto | null>(null);
const statementLoading = ref(false);

async function loadStatement() {
  statementLoading.value = true;
  try {
    statement.value = await monthlyStatement(month.value);
  } finally {
    statementLoading.value = false;
  }
}

// ---------- 支出记录 ----------

const expenses = ref<ExpenseDto[]>([]);
const expensesTotal = ref(0);
const expensesAmount = ref(0);
const expensePage = ref(1);
const expenseLoading = ref(false);

async function loadExpenses() {
  expenseLoading.value = true;
  try {
    const res = await listExpenses({ month: month.value, page: expensePage.value, pageSize: 50 });
    expenses.value = res.items;
    expensesTotal.value = res.total;
    expensesAmount.value = res.totalAmount;
  } finally {
    expenseLoading.value = false;
  }
}

function switchMonth() {
  expensePage.value = 1;
  void loadStatement();
  void loadExpenses();
}

// 新建支出
const expenseVisible = ref(false);
const expenseForm = ref({ date: '', category: 'OTHER', amount: '', title: '', note: '' });

function openExpenseCreate() {
  expenseForm.value = {
    date: new Date().toISOString().slice(0, 10),
    category: 'OTHER',
    amount: '',
    title: '',
    note: '',
  };
  expenseVisible.value = true;
}

async function saveExpense() {
  const f = expenseForm.value;
  const amount = yuanToFen(f.amount);
  if (!f.title.trim()) {
    ElMessage.warning('请填写支出事由');
    return;
  }
  if (amount <= 0) {
    ElMessage.warning('支出金额必须大于 0');
    return;
  }
  if (f.category === 'RESTOCK') {
    ElMessage.warning('补货采购请走「采购应付」登记付款');
    return;
  }
  await createExpense({
    date: new Date(f.date).toISOString(),
    category: f.category,
    amount,
    title: f.title.trim(),
    note: f.note || null,
  });
  ElMessage.success('已记录');
  expenseVisible.value = false;
  void loadExpenses();
  void loadStatement();
}

async function removeExpense(e: ExpenseDto) {
  await ElMessageBox.confirm(`删除支出「${e.title}」${money(e.amount)}？`, '删除支出', { type: 'warning' });
  await deleteExpense(e.id);
  ElMessage.success('已删除');
  void loadExpenses();
  void loadStatement();
}

async function doExport() {
  await exportMonthlyCsv(month.value);
  ElMessage.success('月结报表已导出');
}

onMounted(() => {
  void loadStatement();
  void loadExpenses();
});
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-date-picker v-model="month" type="month" value-format="YYYY-MM" :clearable="false" style="width: 140px" @change="switchMonth" />
      <el-button type="primary" :icon="Download" :loading="statementLoading" @click="doExport">导出月结 CSV</el-button>
      <div class="spacer" />
      <span class="tip">补货采购在「采购应付」中登记付款，此处记录房租/水电/工资等杂项支出</span>
    </div>

    <!-- 月结概览 -->
    <el-row v-if="statement" v-loading="statementLoading" :gutter="12" class="cards">
      <el-col :span="6">
        <div class="kpi">
          <div class="kpi-label">净销售额</div>
          <div class="kpi-value">{{ money(statement.netSalesAmount) }}</div>
          <div class="kpi-sub">{{ statement.orderCount }} 单 · 退款 {{ money(statement.refundAmount) }}</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="kpi">
          <div class="kpi-label">毛利（净销售−销售成本）</div>
          <div class="kpi-value" :class="{ minus: statement.grossProfit < 0 }">{{ money(statement.grossProfit) }}</div>
          <div class="kpi-sub">销售成本 {{ money(statement.cogsAmount) }}（成本快照估算）</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="kpi">
          <div class="kpi-label">采购</div>
          <div class="kpi-value">{{ money(statement.purchaseReceivedAmount) }}</div>
          <div class="kpi-sub">已付款 {{ money(statement.purchasePaidAmount) }}</div>
        </div>
      </el-col>
      <el-col :span="6">
        <div class="kpi">
          <div class="kpi-label">净利估算（毛利−杂项支出）</div>
          <div class="kpi-value" :class="{ minus: statement.netProfitEstimate < 0 }">{{ money(statement.netProfitEstimate) }}</div>
          <div class="kpi-sub">杂项支出 {{ money(statement.expenseTotal) }} · 会员充值 {{ money(statement.memberRechargeAmount) }}</div>
        </div>
      </el-col>
    </el-row>

    <!-- 支出明细 -->
    <div class="toolbar" style="margin-top: 16px">
      <h4 style="margin: 0">支出记录（{{ month }}，合计 {{ money(expensesAmount) }}）</h4>
      <div class="spacer" />
      <el-button type="primary" :icon="Plus" @click="openExpenseCreate">记一笔支出</el-button>
    </div>
    <el-table v-loading="expenseLoading" :data="expenses" size="large">
      <el-table-column label="日期" width="110">
        <template #default="{ row }">{{ row.date.slice(0, 10) }}</template>
      </el-table-column>
      <el-table-column label="类别" width="110" align="center">
        <template #default="{ row }">
          <el-tag size="small" effect="plain">{{ EXPENSE_CATEGORY_LABELS[row.category as keyof typeof EXPENSE_CATEGORY_LABELS] }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="金额" width="110" align="right">
        <template #default="{ row }">{{ money(row.amount) }}</template>
      </el-table-column>
      <el-table-column label="事由" prop="title" min-width="160" />
      <el-table-column label="备注" prop="note" min-width="140" show-overflow-tooltip />
      <el-table-column label="记录人" prop="operatorName" width="100" />
      <el-table-column label="记录时间" width="150">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="90" align="center">
        <template #default="{ row }">
          <el-button size="small" type="danger" text :icon="Delete" @click="removeExpense(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="expensePage"
      :page-size="50"
      :total="expensesTotal"
      layout="total, prev, pager, next"
      class="pager"
      @current-change="loadExpenses"
    />

    <!-- 新建支出 -->
    <el-dialog v-model="expenseVisible" title="记一笔支出" width="440px">
      <el-form label-width="70px">
        <el-form-item label="日期">
          <el-date-picker v-model="expenseForm.date" type="date" value-format="YYYY-MM-DD" style="width: 160px" />
        </el-form-item>
        <el-form-item label="类别">
          <el-select v-model="expenseForm.category" style="width: 160px">
            <el-option v-for="(label, c) in EXPENSE_CATEGORY_LABELS" :key="c" :value="c" :label="label" :disabled="c === 'RESTOCK'" />
          </el-select>
        </el-form-item>
        <el-form-item label="金额">
          <el-input v-model="expenseForm.amount" size="large" placeholder="0.00">
            <template #append>元</template>
          </el-input>
        </el-form-item>
        <el-form-item label="事由">
          <el-input v-model="expenseForm.title" placeholder="如：10 月房租 / 电费" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="expenseForm.note" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="expenseVisible = false">取消</el-button>
        <el-button type="primary" @click="saveExpense">保存</el-button>
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
.tip {
  color: #a4b0be;
  font-size: 12px;
}
.cards {
  margin-bottom: 4px;
}
.kpi {
  background: #f7f8fa;
  border-radius: 8px;
  padding: 14px 16px;
}
.kpi-label {
  color: #57606f;
  font-size: 13px;
}
.kpi-value {
  font-size: 24px;
  font-weight: 700;
  margin: 6px 0 4px;
}
.kpi-value.minus {
  color: #eb3b5a;
}
.kpi-sub {
  color: #a4b0be;
  font-size: 12px;
}
.pager {
  margin-top: 12px;
  justify-content: flex-end;
}
</style>
