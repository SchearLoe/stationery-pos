<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app';
import {
  getStocktake,
  saveStocktakeCounts,
  applyStocktake,
  type StocktakeTaskDto,
  type StocktakeItemDto,
} from '@/api';

const task = ref<StocktakeTaskDto | null>(null);
const dirty = ref<Record<string, number | null>>({});
/** 扫码/手输条码后定位到的商品，输入框自动聚焦 */
const focusedItemId = ref('');
const barcodeInput = ref('');
const onlyDiff = ref(false);

const STATUS_LABELS: Record<string, string> = {
  OPEN: '盘点中',
  APPLIED: '已应用',
  CANCELLED: '已取消',
};

async function load(id: string) {
  task.value = await getStocktake(id);
  dirty.value = {};
}

onLoad((query) => {
  const id = (query as { id?: string })?.id;
  if (id) void load(id);
});
onPullDownRefresh(async () => {
  if (task.value) await load(task.value.id);
  uni.stopPullDownRefresh();
});

const items = computed<StocktakeItemDto[]>(() => {
  const all = task.value?.items ?? [];
  if (!onlyDiff.value) return all;
  return all.filter((i) => {
    const c = dirty.value[i.id] !== undefined ? dirty.value[i.id] : i.countedQty;
    return c !== null && c !== undefined && c !== i.snapshotQty;
  });
});

function displayCount(i: StocktakeItemDto): number | null {
  const v = dirty.value[i.id];
  return v !== undefined ? v : i.countedQty;
}

function setCount(i: StocktakeItemDto, event: { detail: { value: string } }) {
  const raw = `${event.detail.value}`.trim();
  dirty.value = { ...dirty.value, [i.id]: raw === '' ? null : Math.max(0, Math.floor(Number(raw) || 0)) };
}

/** 扫码 / 条码定位：找到商品后聚焦其输入框 */
function locateByBarcode(code: string) {
  const list = task.value?.items ?? [];
  const hit = list.find((i) => i.barcode === code.trim());
  if (!hit) {
    uni.showToast({ title: `未找到条码 ${code}`, icon: 'none' });
    return;
  }
  focusedItemId.value = hit.id;
  onlyDiff.value = false;
}

function scan() {
  uni.scanCode({
    success: (res) => locateByBarcode(res.result ?? ''),
    fail: () => uni.showToast({ title: '扫码取消', icon: 'none' }),
  });
}

async function saveProgress() {
  if (!task.value) return;
  const entries = Object.entries(dirty.value);
  if (!entries.length) {
    uni.showToast({ title: '没有修改需要保存', icon: 'none' });
    return;
  }
  task.value = await saveStocktakeCounts(
    task.value.id,
    entries.map(([id, countedQty]) => ({ id, countedQty })),
  );
  dirty.value = {};
  uni.showToast({ title: '已保存', icon: 'success' });
}

async function doApply() {
  const t = task.value;
  if (!t) return;
  if (Object.keys(dirty.value).length) {
    uni.showToast({ title: '有未保存的实盘数，请先保存', icon: 'none' });
    return;
  }
  const r = await uni.showModal({
    title: '应用盘点差异',
    content: `将按实盘数调整库存（差异 ${t.diffCount ?? 0} 项），应用后任务关闭。`,
    confirmText: '应用',
  });
  if (!r.confirm) return;
  try {
    task.value = await applyStocktake(t.id);
    uni.showToast({ title: '差异已应用', icon: 'success' });
  } catch {
    // 没有差异等情况由请求封装提示
  }
}
</script>

<template>
  <view class="page" v-if="task">
    <view class="card head">
      <view class="row">
        <text class="task-no">{{ task.taskNo }}</text>
        <text class="tag" :class="task.status.toLowerCase()">{{ STATUS_LABELS[task.status] }}</text>
      </view>
      <view class="row sub">
        <text>{{ task.scopeCategoryName ?? '全店' }} · 已盘 {{ task.countedCount }}/{{ task.itemCount }}</text>
        <text>差异 {{ task.diffCount }} 项</text>
      </view>
    </view>

    <template v-if="task.status === 'OPEN'">
      <view class="scan-bar">
        <!-- #ifndef H5 -->
        <button class="mini-btn primary" @click="scan">📷 扫码定位</button>
        <!-- #endif -->
        <!-- #ifdef H5 -->
        <input
          v-model="barcodeInput"
          class="ipt grow"
          placeholder="输入条码定位商品（浏览器无摄像头）"
          @confirm="locateByBarcode(barcodeInput)"
        />
        <button class="mini-btn primary" @click="locateByBarcode(barcodeInput)">定位</button>
        <!-- #endif -->
      </view>
      <view class="toolbar">
        <text class="chip" :class="{ active: onlyDiff }" @click="onlyDiff = !onlyDiff">只看差异</text>
        <view class="spacer" />
        <button class="mini-btn plain" @click="saveProgress">保存进度</button>
        <button class="mini-btn warn" @click="doApply">应用差异</button>
      </view>
    </template>

    <view v-for="i in items" :key="i.id" class="card item">
      <view class="row">
        <view class="name-area">
          <text class="name">{{ i.productName }}<text v-if="i.spec" class="spec"> {{ i.spec }}</text></text>
          <text class="barcode">{{ i.barcode ?? '无条码' }}</text>
        </view>
        <view class="diff-area">
          <text class="snapshot">账面 {{ i.snapshotQty }}</text>
          <text
            v-if="displayCount(i) !== null && displayCount(i) !== undefined"
            class="diff"
            :class="{ hot: displayCount(i) !== i.snapshotQty }"
          >
            {{ (displayCount(i) as number) - i.snapshotQty > 0 ? '+' : '' }}{{ (displayCount(i) as number) - i.snapshotQty }}
          </text>
        </view>
      </view>
      <view class="count-row">
        <text class="count-label">实盘数</text>
        <input
          v-if="task.status === 'OPEN'"
          class="ipt count"
          type="number"
          :value="displayCount(i) ?? ''"
          :focus="focusedItemId === i.id"
          placeholder="未盘"
          @blur="setCount(i, $event as never)"
          @confirm="setCount(i, $event as never)"
        />
        <text v-else class="count-static">{{ i.countedQty ?? '—' }}</text>
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
  font-size: 28rpx;
  font-weight: 600;
}
.tag {
  font-size: 22rpx;
  padding: 4rpx 16rpx;
  border-radius: 8rpx;
  background: #f1f2f6;
}
.tag.open {
  background: #fff3e0;
  color: #e67e22;
}
.tag.applied {
  background: #e8f8f0;
  color: #20bf6b;
}
.scan-bar {
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
.toolbar {
  display: flex;
  align-items: center;
  gap: 12rpx;
  margin-bottom: 16rpx;
}
.spacer {
  flex: 1;
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
.mini-btn {
  font-size: 24rpx;
  padding: 8rpx 24rpx;
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
.mini-btn.plain {
  background: #fff;
  color: #4b7bec;
  border: 1rpx solid #4b7bec;
}
.item .name {
  font-size: 26rpx;
  color: #2f3542;
}
.spec {
  color: #a4b0be;
  font-size: 22rpx;
}
.barcode {
  display: block;
  color: #a4b0be;
  font-size: 20rpx;
  margin-top: 4rpx;
}
.diff-area {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.snapshot {
  color: #a4b0be;
  font-size: 22rpx;
}
.diff {
  font-weight: 700;
  color: #20bf6b;
}
.diff.hot {
  color: #eb3b5a;
}
.count-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 16rpx;
}
.count-label {
  font-size: 24rpx;
  color: #57606f;
}
.count {
  width: 200rpx;
  text-align: center;
  font-weight: 600;
}
.count-static {
  font-size: 28rpx;
  font-weight: 600;
}
</style>
