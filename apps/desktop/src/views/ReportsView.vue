<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { reportDaily, reportStockValue, reportSummary, reportTopProducts } from '@/api';
import { fenToYuan } from '@/utils/money';

const range = ref<[Date, Date]>(defaultRange());
const loading = ref(false);

const summary = ref<Awaited<ReturnType<typeof reportSummary>> | null>(null);
const daily = ref<Awaited<ReturnType<typeof reportDaily>>>([]);
const top = ref<Awaited<ReturnType<typeof reportTopProducts>>>([]);
const stock = ref<Awaited<ReturnType<typeof reportStockValue>> | null>(null);

function defaultRange(): [Date, Date] {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 29);
  return [start, end];
}

function iso(d: Date): string {
  return d.toISOString();
}

const dailyMax = computed(() => Math.max(1, ...daily.value.map((d) => d.sales)));

async function load() {
  loading.value = true;
  try {
    const [from, to] = range.value;
    const fromStr = iso(new Date(from.getFullYear(), from.getMonth(), from.getDate()));
    const toStr = iso(new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59));
    const [s, d, t, v] = await Promise.all([
      reportSummary(fromStr, toStr),
      reportDaily(fromStr, toStr),
      reportTopProducts(fromStr, toStr, 15),
      reportStockValue(),
    ]);
    summary.value = s;
    daily.value = d;
    top.value = t;
    stock.value = v;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div v-loading="loading">
    <el-card>
      <div class="toolbar">
        <span class="label">统计区间：</span>
        <el-date-picker
          v-model="range"
          type="daterange"
          :clearable="false"
          :disabled-date="(d: Date) => d > new Date()"
        />
        <el-button type="primary" @click="load">查询</el-button>
      </div>
    </el-card>

    <div class="cards" v-if="summary">
      <el-card class="kpi">
        <div class="kpi-label">净销售额</div>
        <div class="kpi-value">¥{{ fenToYuan(summary.netAmount) }}</div>
        <div class="kpi-sub">销售 ¥{{ fenToYuan(summary.salesAmount) }} − 退货 ¥{{ fenToYuan(summary.refundAmount) }}</div>
      </el-card>
      <el-card class="kpi">
        <div class="kpi-label">订单数</div>
        <div class="kpi-value">{{ summary.orderCount }}</div>
        <div class="kpi-sub">退货 {{ summary.refundCount }} 单</div>
      </el-card>
      <el-card class="kpi">
        <div class="kpi-label">客单价</div>
        <div class="kpi-value">¥{{ fenToYuan(summary.orderCount ? Math.round(summary.salesAmount / summary.orderCount) : 0) }}</div>
      </el-card>
      <el-card class="kpi" v-if="stock">
        <div class="kpi-label">库存资金（成本）</div>
        <div class="kpi-value">¥{{ fenToYuan(stock.totalValue) }}</div>
        <div class="kpi-sub">{{ stock.totalQty }} 件 / 低库存 {{ stock.lowStockSkuCount }} 种</div>
      </el-card>
    </div>

    <div class="two-col">
      <el-card>
        <template #header>每日销售额</template>
        <div class="daily-chart">
          <div v-for="d in daily" :key="d.date" class="daily-row">
            <span class="daily-date">{{ d.date.slice(5) }}</span>
            <div class="daily-bar-wrap">
              <div class="daily-bar" :style="{ width: `${(d.sales / dailyMax) * 100}%` }" :title="`¥${fenToYuan(d.sales)}`" />
            </div>
            <span class="daily-amount">{{ d.sales ? `¥${fenToYuan(d.sales)}` : '' }}</span>
          </div>
        </div>
      </el-card>

      <el-card>
        <template #header>支付方式分布</template>
        <el-descriptions :column="1" border size="small" v-if="summary">
          <el-descriptions-item v-for="m in summary.byMethod" :key="m.method" :label="m.method">
            ¥{{ fenToYuan(m.amount) }}（{{ m.count }} 笔）
          </el-descriptions-item>
          <el-descriptions-item v-if="summary.byMethod.length === 0">该区间无数据</el-descriptions-item>
        </el-descriptions>
      </el-card>
    </div>

    <el-card style="margin-top: 14px">
      <template #header>商品销量排行（Top 15）</template>
      <el-table :data="top" size="small" stripe>
        <el-table-column type="index" label="#" width="50" />
        <el-table-column label="商品" min-width="220">
          <template #default="{ row }">{{ row.productName }}<span v-if="row.spec" class="sub"> {{ row.spec }}</span></template>
        </el-table-column>
        <el-table-column label="销量" width="100" align="center" prop="qty" />
        <el-table-column label="销售额" width="120" align="right">
          <template #default="{ row }">¥{{ fenToYuan(row.amount) }}</template>
        </el-table-column>
      </el-table>
    </el-card>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
}
.label {
  color: #57606f;
}
.cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-top: 14px;
}
.kpi-label {
  color: #a4b0be;
  font-size: 13px;
}
.kpi-value {
  font-size: 26px;
  font-weight: 700;
  color: #2f3542;
  margin: 6px 0 2px;
}
.kpi-sub {
  color: #a4b0be;
  font-size: 12px;
}
.two-col {
  display: grid;
  grid-template-columns: 2fr 1fr;
  gap: 12px;
  margin-top: 14px;
}
.daily-chart {
  max-height: 380px;
  overflow: auto;
}
.daily-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 3px;
}
.daily-date {
  width: 42px;
  color: #a4b0be;
  font-size: 12px;
}
.daily-bar-wrap {
  flex: 1;
  background: #f1f2f6;
  border-radius: 3px;
  height: 16px;
}
.daily-bar {
  background: linear-gradient(90deg, #4b7bec, #3867d6);
  height: 100%;
  border-radius: 3px;
  min-width: 0;
}
.daily-amount {
  width: 90px;
  text-align: right;
  font-size: 12px;
  color: #57606f;
}
.sub {
  color: #a4b0be;
  font-size: 12px;
}
</style>
