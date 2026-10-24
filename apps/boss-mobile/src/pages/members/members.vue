<script setup lang="ts">
import { ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import { listMembers, rechargeMember, fenToYuan, yuanToFen, money, type MemberDto } from '@/api';

const keyword = ref('');
const members = ref<MemberDto[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await listMembers({
      keyword: keyword.value.trim() || undefined,
      page: 1,
      pageSize: 50,
    });
    members.value = res.items;
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

// 充值弹层
const rechargeVisible = ref(false);
const target = ref<MemberDto | null>(null);
const amount = ref('');
const bonus = ref('');
const method = ref<'CASH' | 'WECHAT' | 'ALIPAY'>('CASH');

function openRecharge(m: MemberDto) {
  target.value = m;
  amount.value = '';
  bonus.value = '';
  method.value = 'CASH';
  rechargeVisible.value = true;
}

async function confirmRecharge() {
  const m = target.value;
  if (!m) return;
  const fen = yuanToFen(amount.value);
  const bonusFen = yuanToFen(bonus.value);
  if (fen <= 0) {
    uni.showToast({ title: '充值金额必须大于 0', icon: 'none' });
    return;
  }
  await rechargeMember(m.id, {
    amount: fen,
    bonus: bonusFen > 0 ? bonusFen : undefined,
    method: method.value,
  });
  uni.showToast({ title: `充值成功（${m.name}）`, icon: 'success' });
  rechargeVisible.value = false;
  void load();
}
</script>

<template>
  <view class="page">
    <view class="search">
      <input
        v-model="keyword"
        class="ipt grow"
        placeholder="姓名 / 手机号 / 会员码"
        confirm-type="search"
        @confirm="load()"
      />
      <button class="mini-btn primary" @click="load()">查询</button>
    </view>

    <view v-for="m in members" :key="m.id" class="card">
      <view class="row">
        <view class="name-area">
          <text class="name">{{ m.name }} <text class="code">{{ m.code }}</text></text>
          <text class="phone">{{ m.phone ?? '未留手机号' }}</text>
        </view>
        <button class="mini-btn warn" @click="openRecharge(m)">充值</button>
      </view>
      <view class="row sub">
        <text>储值 {{ money(m.balance) }}</text>
        <text>积分 {{ m.points }}</text>
        <text class="status" :class="{ off: !m.active }">{{ m.active ? '正常' : '停用' }}</text>
      </view>
    </view>
    <text v-if="!members.length && !loading" class="empty">没有匹配的会员</text>

    <!-- 充值弹层 -->
    <view v-if="rechargeVisible" class="mask" @click="rechargeVisible = false">
      <view class="dialog" @click.stop="">
        <text class="dialog-title">会员充值 · {{ target?.name }}</text>
        <text class="dialog-sub">当前余额 {{ money(target?.balance ?? 0) }} · 积分 {{ target?.points }}</text>
        <view class="field">
          <text class="label">充值金额（元）</text>
          <input v-model="amount" class="ipt" type="digit" placeholder="实收金额" />
        </view>
        <view class="field">
          <text class="label">赠送金额（元，选填）</text>
          <input v-model="bonus" class="ipt" type="digit" placeholder="如充100送20填20" />
        </view>
        <view class="field">
          <text class="label">收款方式</text>
          <view class="chips">
            <text
              v-for="m in ['CASH', 'WECHAT', 'ALIPAY']"
              :key="m"
              class="chip"
              :class="{ active: method === m }"
              @click="method = m as never"
            >
              {{ { CASH: '现金', WECHAT: '微信', ALIPAY: '支付宝' }[m] }}
            </text>
          </view>
        </view>
        <button class="btn" @click="confirmRecharge">确认充值</button>
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
.search {
  display: flex;
  gap: 12rpx;
  margin-bottom: 16rpx;
}
.grow {
  flex: 1;
}
.ipt {
  border: 1rpx solid #e1e4eb;
  border-radius: 12rpx;
  padding: 14rpx 20rpx;
  font-size: 26rpx;
  background: #fff;
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
  margin-top: 12rpx;
  color: #57606f;
  font-size: 24rpx;
}
.name {
  font-size: 28rpx;
  font-weight: 600;
  color: #2f3542;
}
.code {
  color: #4b7bec;
  font-size: 22rpx;
  font-weight: 400;
}
.phone {
  display: block;
  color: #a4b0be;
  font-size: 22rpx;
  margin-top: 4rpx;
}
.status.off {
  color: #a4b0be;
}
.empty {
  display: block;
  text-align: center;
  color: #a4b0be;
  padding: 48rpx 0;
}
.mini-btn {
  font-size: 24rpx;
  padding: 8rpx 28rpx;
  border-radius: 24rpx;
  line-height: 1.8;
  margin: 0;
}
.mini-btn.primary {
  background: #4b7bec;
  color: #fff;
}
.mini-btn.warn {
  background: #20bf6b;
  color: #fff;
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
.chips {
  display: flex;
  gap: 12rpx;
  flex-wrap: wrap;
}
.chip {
  font-size: 24rpx;
  color: #57606f;
  background: #f5f6fa;
  border-radius: 24rpx;
  padding: 8rpx 24rpx;
}
.chip.active {
  background: #4b7bec;
  color: #fff;
}
.btn {
  background: #4b7bec;
  color: #fff;
  border-radius: 40rpx;
  font-size: 28rpx;
}
</style>
