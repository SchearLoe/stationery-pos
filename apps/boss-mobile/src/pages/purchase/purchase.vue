<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import {
  listPurchaseOrders,
  purchasePayables,
  receivePurchase,
  cancelPurchase,
  payPurchase,
  fenToYuan,
  yuanToFen,
  money,
  type PurchaseOrderDto,
  type PayableSummaryDto,
} from '@/api';

const tab = ref<'orders' | 'payables'>('orders');
const status = ref<'' | 'DRAFT' | 'RECEIVED' | 'CANCELLED'>('');
const orders = ref<PurchaseOrderDto[]>([]);
const payables = ref<PayableSummaryDto[]>([]);
const loading = ref(false);

const STATUS_LABELS: Record<string, string> = {
  DRAFT: '待入库',
  RECEIVED: '已入库',
  CANCELLED: '已取消',
};

async function load() {
  loading.value = true;
  try {
    if (tab.value === 'orders') {
      const res = await listPurchaseOrders({
        status: status.value || undefined,
        page: 1,
        pageSize: 30,
      });
      orders.value = res.items;
    } else {
      payables.value = await purchasePayables();
    }
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

function switchTab(t: 'orders' | 'payables') {
  tab.value = t;
  void load();
}

async function doReceive(o: PurchaseOrderDto) {
  const r = await uni.showModal({
    title: '确认入库',
    content: `${o.orderNo}（${money(o.totalAmount)}）到货了吗？入库将增加库存并更新商品成本。`,
  });
  if (!r.confirm) return;
  await receivePurchase(o.id);
  uni.showToast({ title: '入库成功', icon: 'success' });
  void load();
}

async function doCancel(o: PurchaseOrderDto) {
  const r = await uni.showModal({
    title: '取消采购',
    content: `确定取消采购单 ${o.orderNo}？`,
  });
  if (!r.confirm) return;
  await cancelPurchase(o.id);
  uni.showToast({ title: '已取消', icon: 'success' });
  void load();
}

// 付款弹层
const payVisible = ref(false);
const payTarget = ref<PurchaseOrderDto | null>(null);
const payAmount = ref('');
const payMethod = ref<'CASH' | 'WECHAT' | 'ALIPAY' | 'CARD'>('CASH');

function openPay(o: PurchaseOrderDto) {
  payTarget.value = o;
  payAmount.value = fenToYuan(o.payableAmount);
  payMethod.value = 'CASH';
  payVisible.value = true;
}

async function confirmPay() {
  const o = payTarget.value;
  if (!o) return;
  const fen = yuanToFen(payAmount.value);
  if (fen <= 0 || fen > o.payableAmount) {
    uni.showToast({ title: '付款金额不合法', icon: 'none' });
    return;
  }
  await payPurchase(o.id, { amount: fen, method: payMethod.value });
  uni.showToast({ title: '付款已登记', icon: 'success' });
  payVisible.value = false;
  void load();
}

const totalPayable = computed(() => payables.value.reduce((n, p) => n + p.payable, 0));
</script>

<template>
  <view class="page">
    <view class="tabs">
      <text class="tab" :class="{ active: tab === 'orders' }" @click="switchTab('orders')">采购单</text>
      <text class="tab" :class="{ active: tab === 'payables' }" @click="switchTab('payables')">应付汇总</text>
    </view>

    <view v-if="tab === 'orders'">
      <view class="filter">
        <text
          v-for="s in ['', 'DRAFT', 'RECEIVED', 'CANCELLED']"
          :key="s"
          class="chip"
          :class="{ active: status === s }"
          @click="status = s as never; load()"
        >
          {{ s === '' ? '全部' : STATUS_LABELS[s] }}
        </text>
      </view>

      <view v-for="o in orders" :key="o.id" class="card">
        <view class="row">
          <text class="order-no">{{ o.orderNo }}</text>
          <text class="tag" :class="o.status.toLowerCase()">{{ STATUS_LABELS[o.status] }}</text>
        </view>
        <view class="row sub">
          <text>{{ o.supplierName }} · {{ o.itemCount ?? '-' }} 种商品</text>
          <text>{{ o.createdAt?.slice(0, 10) }}</text>
        </view>
        <view class="row amounts">
          <text>采购 {{ money(o.totalAmount) }}</text>
          <text>已付 {{ money(o.paidAmount) }}</text>
          <text class="hot" v-if="o.payableAmount > 0">应付 {{ money(o.payableAmount) }}</text>
        </view>
        <view class="actions">
          <button v-if="o.status === 'DRAFT'" class="mini-btn primary" @click="doReceive(o)">入库</button>
          <button
            v-if="o.status === 'RECEIVED' && o.payableAmount > 0"
            class="mini-btn warn"
            @click="openPay(o)"
          >
            付款
          </button>
          <button v-if="o.status === 'DRAFT'" class="mini-btn plain" @click="doCancel(o)">取消</button>
        </view>
      </view>
      <text v-if="!orders.length && !loading" class="empty">暂无采购单</text>
    </view>

    <view v-else>
      <view class="card total">
        <text>应付总额（全部供应商）</text>
        <text class="hot">{{ money(totalPayable) }}</text>
      </view>
      <view v-for="p in payables" :key="p.supplierId" class="card">
        <view class="row">
          <text class="order-no">{{ p.supplierName }}</text>
          <text class="hot">{{ money(p.payable) }}</text>
        </view>
        <view class="row sub">
          <text>入库 {{ money(p.receivedTotal) }} · 已付 {{ money(p.paidTotal) }} · {{ p.orderCount }} 单</text>
        </view>
      </view>
      <text v-if="!payables.length" class="empty">没有应付记录</text>
    </view>

    <!-- 付款弹层 -->
    <view v-if="payVisible" class="mask" @click="payVisible = false">
      <view class="dialog" @click.stop="">
        <text class="dialog-title">采购付款</text>
        <text class="dialog-sub">{{ payTarget?.orderNo }} · 应付余额 {{ money(payTarget?.payableAmount ?? 0) }}</text>
        <view class="field">
          <text class="label">金额（元）</text>
          <input v-model="payAmount" class="ipt" type="digit" />
        </view>
        <view class="field">
          <text class="label">方式</text>
          <view class="chips">
            <text
              v-for="m in ['CASH', 'WECHAT', 'ALIPAY', 'CARD']"
              :key="m"
              class="chip"
              :class="{ active: payMethod === m }"
              @click="payMethod = m as never"
            >
              {{ { CASH: '现金', WECHAT: '微信', ALIPAY: '支付宝', CARD: '转账' }[m] }}
            </text>
          </view>
        </view>
        <button class="btn" @click="confirmPay">登记付款</button>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f5f6fa;
  padding: 24rpx;
}
.tabs {
  display: flex;
  gap: 24rpx;
  margin-bottom: 20rpx;
}
.tab {
  font-size: 30rpx;
  color: #a4b0be;
  padding-bottom: 8rpx;
}
.tab.active {
  color: #2f3542;
  font-weight: 700;
  border-bottom: 4rpx solid #4b7bec;
}
.filter {
  display: flex;
  gap: 12rpx;
  margin-bottom: 16rpx;
  flex-wrap: wrap;
}
.chip {
  font-size: 24rpx;
  color: #57606f;
  background: #fff;
  border-radius: 24rpx;
  padding: 8rpx 24rpx;
}
.chip.active {
  background: #4b7bec;
  color: #fff;
}
.card {
  background: #fff;
  border-radius: 16rpx;
  padding: 24rpx;
  margin-bottom: 16rpx;
}
.row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.row.sub {
  margin-top: 8rpx;
  color: #a4b0be;
  font-size: 22rpx;
}
.order-no {
  font-size: 26rpx;
  font-weight: 600;
  color: #2f3542;
}
.tag {
  font-size: 22rpx;
  padding: 4rpx 16rpx;
  border-radius: 8rpx;
  background: #f1f2f6;
  color: #57606f;
}
.tag.draft {
  background: #fff3e0;
  color: #e67e22;
}
.tag.received {
  background: #e8f8f0;
  color: #20bf6b;
}
.amounts {
  margin-top: 12rpx;
  font-size: 24rpx;
  color: #57606f;
  gap: 16rpx;
}
.hot {
  color: #eb3b5a;
  font-weight: 600;
}
.actions {
  display: flex;
  gap: 12rpx;
  margin-top: 16rpx;
  justify-content: flex-end;
}
.mini-btn {
  font-size: 24rpx;
  padding: 8rpx 28rpx;
  border-radius: 24rpx;
  line-height: 1.6;
  margin: 0;
}
.mini-btn.primary {
  background: #20bf6b;
  color: #fff;
}
.mini-btn.warn {
  background: #4b7bec;
  color: #fff;
}
.mini-btn.plain {
  background: #fff;
  color: #eb3b5a;
  border: 1rpx solid #eb3b5a;
}
.total {
  display: flex;
  justify-content: space-between;
  font-size: 28rpx;
}
.empty {
  display: block;
  text-align: center;
  color: #a4b0be;
  padding: 48rpx 0;
}
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9;
}
.dialog {
  width: 600rpx;
  background: #fff;
  border-radius: 20rpx;
  padding: 32rpx;
  display: flex;
  flex-direction: column;
  gap: 20rpx;
}
.dialog-title {
  font-size: 32rpx;
  font-weight: 700;
}
.dialog-sub {
  font-size: 22rpx;
  color: #a4b0be;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 8rpx;
}
.label {
  font-size: 24rpx;
  color: #57606f;
}
.ipt {
  border: 1rpx solid #e1e4eb;
  border-radius: 12rpx;
  padding: 16rpx 20rpx;
}
.chips {
  display: flex;
  gap: 12rpx;
  flex-wrap: wrap;
}
.btn {
  background: #4b7bec;
  color: #fff;
  border-radius: 40rpx;
  font-size: 28rpx;
}
</style>
