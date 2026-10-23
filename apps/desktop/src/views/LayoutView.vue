<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { SwitchButton, Coin, ShoppingCart, Goods, Box, RefreshLeft, Clock, DataAnalysis, UserFilled, Setting } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';
import { useSettingsStore } from '@/stores/settings';
import { useSyncStore } from '@/stores/sync';
import { currentShift } from '@/api';
import type { OutboxSale } from '@/services/outbox';
import { fenToYuan, formatTime } from '@/utils/money';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const settingsStore = useSettingsStore();
const sync = useSyncStore();

const shiftOpen = ref(false);

async function refreshShift() {
  try {
    shiftOpen.value = !!(await currentShift());
  } catch {
    shiftOpen.value = false;
  }
}

onMounted(() => {
  void settingsStore.load();
  void refreshShift();
  void sync.init();
});

// 同步状态角标
const syncTagType = computed(() => {
  if (!sync.online) return 'danger';
  if (sync.pendingCount > 0 || sync.failedCount > 0) return 'warning';
  return 'success';
});
const syncTagText = computed(() => {
  if (!sync.online) return '离线模式';
  if (sync.failedCount > 0) return `${sync.failedCount} 单同步失败`;
  if (sync.pendingCount > 0) return `待同步 ${sync.pendingCount} 单`;
  if (sync.syncing) return '同步中…';
  return '已同步';
});

const syncVisible = ref(false);

const menuItems = computed(() => {
  const items = [
    { path: '/register', label: '收银台', icon: ShoppingCart },
    { path: '/orders', label: '销售记录', icon: Coin },
    { path: '/refund', label: '退货', icon: RefreshLeft },
    { path: '/shift', label: '交接班', icon: Clock },
    { path: '/inventory', label: '库存', icon: Box },
  ];
  if (auth.isBoss) {
    items.push(
      { path: '/products', label: '商品管理', icon: Goods },
      { path: '/reports', label: '经营分析', icon: DataAnalysis },
      { path: '/users', label: '账号管理', icon: UserFilled },
      { path: '/settings', label: '系统设置', icon: Setting },
    );
  }
  return items;
});

async function logout() {
  await ElMessageBox.confirm('确定退出登录吗？', '提示', { type: 'warning' });
  auth.logout();
  void router.push('/login');
}

/** 删除同步失败的离线单（已确认该单不需要入账时才可删，防止误删现金流水） */
async function removeFailed(row: OutboxSale) {
  await ElMessageBox.confirm(
    `确定丢弃离线单 ${row.clientOrderNo}（¥${fenToYuan(row.receipt.payableAmount)}）吗？删除后该单将不再同步入账，请确认这笔钱已手工处理。`,
    '删除失败单',
    { type: 'error', confirmButtonText: '确认丢弃', cancelButtonText: '取消' },
  );
  await sync.removeFailed(row.clientId);
}
</script>

<template>
  <el-container class="layout">
    <el-aside width="200px" class="aside">
      <div class="logo">
        <div class="logo-name">{{ settingsStore.settings.storeName }}</div>
        <div class="logo-sub">文具店收银系统</div>
      </div>
      <el-menu :default-active="route.path" router class="menu">
        <el-menu-item v-for="item in menuItems" :key="item.path" :index="item.path">
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="header-left">
          <el-tag :type="shiftOpen ? 'success' : 'info'" effect="dark" size="large">
            {{ shiftOpen ? '班次进行中' : '未开班' }}
          </el-tag>
          <el-tag :type="syncTagType" effect="plain" size="large" style="cursor: pointer" @click="syncVisible = true">
            {{ syncTagText }}
          </el-tag>
        </div>
        <div class="header-right">
          <span class="user-name">{{ auth.userName }}（{{ auth.isBoss ? '老板' : '收银员' }}）</span>
          <el-button :icon="SwitchButton" circle text @click="logout" title="退出登录" />
        </div>
      </el-header>
      <el-main class="main">
        <router-view @shift-changed="refreshShift" />
      </el-main>
    </el-container>

    <!-- 同步中心 -->
    <el-dialog v-model="syncVisible" title="离线同步" width="620px">
      <div class="sync-head">
        <el-tag :type="sync.online ? 'success' : 'danger'">{{ sync.online ? '网络正常' : '网络离线' }}</el-tag>
        <span v-if="sync.lastSyncAt" class="sub">上次同步 {{ formatTime(new Date(sync.lastSyncAt)) }}</span>
        <div class="spacer" />
        <el-button type="primary" size="small" :loading="sync.syncing" :disabled="!sync.online" @click="sync.flush()">
          立即同步
        </el-button>
      </div>
      <el-alert
        v-if="sync.items.length === 0"
        title="没有待同步的离线单据"
        type="success"
        :closable="false"
      />
      <template v-else>
        <el-alert
          type="info"
          :closable="false"
          title="断网期间的销售单会保存在本机，网络恢复后自动按下单顺序上传云端"
          style="margin-bottom: 8px"
        />
        <el-table :data="sync.items" size="small" max-height="320">
          <el-table-column label="单号" prop="clientOrderNo" width="150" />
          <el-table-column label="下单时间" width="100">
            <template #default="{ row }">{{ formatTime(new Date(row.createdAt)) }}</template>
          </el-table-column>
          <el-table-column label="金额" width="90" align="right">
            <template #default="{ row }">¥{{ fenToYuan(row.receipt.payableAmount) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="100" align="center">
            <template #default="{ row }">
              <el-tag :type="row.status === 'PENDING' ? 'warning' : 'danger'" size="small">
                {{ row.status === 'PENDING' ? '待同步' : '失败' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="失败原因" min-width="140">
            <template #default="{ row }">
              <span class="sub">{{ row.failedReason ?? '-' }}</span>
            </template>
          </el-table-column>
          <el-table-column width="150" align="center">
            <template #default="{ row }">
              <template v-if="row.status === 'FAILED'">
                <el-button size="small" @click="sync.retry(row.clientId)">重试</el-button>
                <el-button size="small" type="danger" text @click="removeFailed(row)">删除</el-button>
              </template>
            </template>
          </el-table-column>
        </el-table>
      </template>
    </el-dialog>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100%;
}
.aside {
  background: #2f3542;
  display: flex;
  flex-direction: column;
}
.logo {
  color: #fff;
  padding: 20px 16px 12px;
}
.logo-name {
  font-size: 18px;
  font-weight: 600;
}
.logo-sub {
  font-size: 11px;
  color: #a4b0be;
  margin-top: 2px;
}
.menu {
  border-right: none;
  background: transparent;
  flex: 1;
}
.menu :deep(.el-menu-item) {
  color: #d2dae2;
}
.menu :deep(.el-menu-item.is-active) {
  background: #4b7bec;
  color: #fff;
}
.menu :deep(.el-menu-item:hover) {
  background: rgba(255, 255, 255, 0.08);
}
.header {
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #e6e9f0;
  height: 56px;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.sync-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}
.sync-head .spacer {
  flex: 1;
}
.sub {
  color: #a4b0be;
  font-size: 12px;
}
.user-name {
  color: #57606f;
}
.main {
  padding: 16px;
  overflow: auto;
}
</style>
