<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { SwitchButton, Coin, ShoppingCart, Goods, Box, RefreshLeft, Clock, DataAnalysis, UserFilled, Setting } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';
import { useSettingsStore } from '@/stores/settings';
import { currentShift } from '@/api';

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();
const settingsStore = useSettingsStore();

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
});

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
.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}
.user-name {
  color: #57606f;
}
.main {
  padding: 16px;
  overflow: auto;
}
</style>
