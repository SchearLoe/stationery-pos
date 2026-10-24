<script setup lang="ts">
import { ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import {
  listStocktakes,
  createStocktake,
  cancelStocktake,
  type StocktakeTaskDto,
} from '@/api';

const STATUS_LABELS: Record<string, string> = {
  OPEN: '盘点中',
  APPLIED: '已应用',
  CANCELLED: '已取消',
};

const tasks = ref<StocktakeTaskDto[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const res = await listStocktakes({ page: 1, pageSize: 30 });
    tasks.value = res.items;
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

async function doCreate() {
  const r = await uni.showModal({
    title: '新建盘点任务',
    content: '将按当前账面库存快照创建全店盘点任务，确认创建？',
    confirmText: '创建',
  });
  if (!r.confirm) return;
  try {
    const task = await createStocktake({ note: '老板端发起' });
    uni.showToast({ title: `已创建（${task.itemCount ?? 0} 项）`, icon: 'success' });
    await load();
    uni.navigateTo({ url: `/pages/stocktake/detail?id=${task.id}` });
  } catch {
    // 提示已由请求封装处理
  }
}

function open(t: StocktakeTaskDto) {
  uni.navigateTo({ url: `/pages/stocktake/detail?id=${t.id}` });
}

async function doCancel(t: StocktakeTaskDto) {
  const r = await uni.showModal({
    title: '取消任务',
    content: `确定取消盘点任务 ${t.taskNo}？`,
  });
  if (!r.confirm) return;
  await cancelStocktake(t.id);
  uni.showToast({ title: '已取消', icon: 'success' });
  void load();
}
</script>

<template>
  <view class="page">
    <button class="btn" @click="doCreate">＋ 新建全店盘点</button>

    <view v-for="t in tasks" :key="t.id" class="card" @click="open(t)">
      <view class="row">
        <text class="task-no">{{ t.taskNo }}</text>
        <text class="tag" :class="t.status.toLowerCase()">{{ STATUS_LABELS[t.status] }}</text>
      </view>
      <view class="row sub">
        <text>{{ t.scopeCategoryName ?? '全店' }} · 已盘 {{ t.countedCount ?? 0 }}/{{ t.itemCount ?? 0 }}</text>
        <text>差异 {{ t.diffCount ?? 0 }} 项</text>
      </view>
      <view class="row sub">
        <text>{{ t.createdAt?.slice(0, 16).replace('T', ' ') }}</text>
        <text v-if="t.status === 'OPEN'" class="open" @click.stop="doCancel(t)">取消</text>
      </view>
    </view>
    <text v-if="!tasks.length && !loading" class="empty">还没有盘点任务</text>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f5f6fa;
  padding: 24rpx;
}
.btn {
  background: #4b7bec;
  color: #fff;
  border-radius: 40rpx;
  font-size: 28rpx;
  margin-bottom: 20rpx;
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
.task-no {
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
.tag.open {
  background: #fff3e0;
  color: #e67e22;
}
.tag.applied {
  background: #e8f8f0;
  color: #20bf6b;
}
.open {
  color: #eb3b5a;
}
.empty {
  display: block;
  text-align: center;
  color: #a4b0be;
  padding: 48rpx 0;
}
</style>
