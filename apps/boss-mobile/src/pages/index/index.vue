<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import {
  reportSummary,
  reportDaily,
  reportStockValue,
  money,
  todayStart,
  todayEnd,
  daysAgoStart,
  type SummaryDto,
  type DailyDto,
  type StockValueDto,
} from '@/api';
import { getUser } from '@/api/request';

const summary = ref<SummaryDto | null>(null);
const daily = ref<DailyDto[]>([]);
const stock = ref<StockValueDto | null>(null);
const loading = ref(false);

const bossName = computed(() => getUser()?.name ?? '老板');
const avgTicket = computed(() =>
  summary.value && summary.value.orderCount
    ? Math.round(summary.value.salesAmount / summary.value.orderCount)
    : 0,
);
const dailyMax = computed(() => Math.max(1, ...daily.value.map((d) => d.sales)));

async function load() {
  loading.value = true;
  try {
    const from = daysAgoStart(13);
    const to = todayEnd();
    const [s, d, v] = await Promise.all([
      reportSummary(todayStart(), to),
      reportDaily(from, to),
      reportStockValue(),
    ]);
    summary.value = s;
    daily.value = d;
    stock.value = v;
  } catch {
    // 提示已由请求封装处理
  } finally {
    loading.value = false;
  }
}

onShow(() => {
  if (uni.getStorageSync('token')) void load();
});

onPullDownRefresh(async () => {
  await load();
  uni.stopPullDownRefresh();
});

function go(url: string) {
  uni.navigateTo({ url });
}

function doLogout() {
  uni.showModal({
    title: '退出登录',
    content: '确定退出老板端吗？',
    success: (r) => {
      if (r.confirm) {
        uni.removeStorageSync('token');
        uni.removeStorageSync('user');
        uni.reLaunch({ url: '/pages/login/login' });
      }
    },
  });
}
</script>

<template>
  <view class="page">
    <view class="head">
      <text class="hi">{{ bossName }}，看一下今天的店：</text>
      <text class="logout" @click="doLogout">退出</text>
    </view>

    <view class="kpis">
      <view class="kpi">
        <text class="kpi-label">今日净销售</text>
        <text class="kpi-value">{{ money(summary?.netAmount ?? 0) }}</text>
        <text class="kpi-sub">{{ summary?.orderCount ?? 0 }} 单 · 退款 {{ money(summary?.refundAmount ?? 0) }}</text>
      </view>
      <view class="kpi">
        <text class="kpi-label">今日客单价</text>
        <text class="kpi-value">{{ money(avgTicket) }}</text>
        <text class="kpi-sub">销售额 {{ money(summary?.salesAmount ?? 0) }}</text>
      </view>
      <view class="kpi">
        <text class="kpi-label">库存资金（成本）</text>
        <text class="kpi-value">{{ money(stock?.totalValue ?? 0) }}</text>
        <text class="kpi-sub">{{ stock?.totalQty ?? 0 }} 件 · 低库存 {{ stock?.lowStockSkuCount ?? 0 }} 种</text>
      </view>
    </view>

    <view class="entries">
      <view class="entry" @click="go('/pages/purchase/purchase')">
        <text class="entry-icon">🚚</text>
        <text class="entry-label">采购应付</text>
      </view>
      <view class="entry" @click="go('/pages/stocktake/stocktake')">
        <text class="entry-icon">📋</text>
        <text class="entry-label">扫码盘点</text>
      </view>
      <view class="entry" @click="go('/pages/members/members')">
        <text class="entry-icon">👤</text>
        <text class="entry-label">会员储值</text>
      </view>
    </view>

    <view class="card">
      <text class="card-title">近 14 天净销售</text>
      <view class="chart">
        <view v-for="d in daily" :key="d.date" class="bar-col">
          <view class="bar" :style="{ height: `${Math.max(4, (d.net / dailyMax) * 160)}rpx` }" />
          <text class="bar-label">{{ d.date.slice(5) }}</text>
        </view>
      </view>
    </view>

    <view class="card">
      <text class="card-title">今日支付方式</text>
      <view v-if="summary?.byMethod?.length" class="methods">
        <view v-for="m in summary.byMethod" :key="m.method" class="method-row">
          <text class="method-name">{{ m.method }}</text>
          <text class="method-amount">{{ money(m.amount) }}（{{ m.count }} 笔）</text>
        </view>
      </view>
      <text v-else class="empty">今天还没有收款</text>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f5f6fa;
  padding: 24rpx;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 20rpx;
}
.hi {
  font-size: 32rpx;
  font-weight: 600;
  color: #2f3542;
}
.logout {
  color: #4b7bec;
  font-size: 26rpx;
}
.kpis {
  display: flex;
  flex-direction: column;
  gap: 16rpx;
  margin-bottom: 20rpx;
}
.kpi {
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}
.kpi-label {
  font-size: 24rpx;
  color: #a4b0be;
}
.kpi-value {
  font-size: 40rpx;
  font-weight: 700;
  color: #eb3b5a;
}
.kpi-sub {
  font-size: 22rpx;
  color: #a4b0be;
}
.entries {
  display: flex;
  gap: 16rpx;
  margin-bottom: 20rpx;
}
.entry {
  flex: 1;
  background: #2f3542;
  border-radius: 16rpx;
  padding: 28rpx 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
}
.entry-icon {
  font-size: 44rpx;
}
.entry-label {
  color: #fff;
  font-size: 24rpx;
}
.card {
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 20rpx;
}
.card-title {
  font-size: 28rpx;
  font-weight: 600;
  color: #2f3542;
}
.chart {
  display: flex;
  align-items: flex-end;
  gap: 8rpx;
  margin-top: 24rpx;
  height: 220rpx;
}
.bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  gap: 8rpx;
}
.bar {
  width: 100%;
  background: #4b7bec;
  border-radius: 6rpx 6rpx 0 0;
  min-height: 4rpx;
}
.bar-label {
  font-size: 18rpx;
  color: #a4b0be;
}
.methods {
  margin-top: 16rpx;
}
.method-row {
  display: flex;
  justify-content: space-between;
  padding: 12rpx 0;
  border-bottom: 1rpx solid #f1f2f6;
}
.method-name {
  color: #57606f;
}
.method-amount {
  color: #2f3542;
}
.empty {
  display: block;
  text-align: center;
  color: #a4b0be;
  padding: 24rpx 0;
  font-size: 24rpx;
}
</style>
