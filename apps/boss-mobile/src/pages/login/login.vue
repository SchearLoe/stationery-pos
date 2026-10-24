<script setup lang="ts">
import { ref } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import { getApiBase, setApiBase, http, getToken, logout } from '@/api/request';
import { login } from '@/api';

const apiBase = ref(getApiBase());
const username = ref('boss');
const password = ref('');
const loading = ref(false);

onShow(() => {
  if (getToken()) {
    // 已登录直接进入概览
    uni.reLaunch({ url: '/pages/index/index' });
  }
});

async function doLogin() {
  if (!username.value.trim() || !password.value) {
    uni.showToast({ title: '请输入账号密码', icon: 'none' });
    return;
  }
  loading.value = true;
  try {
    setApiBase(apiBase.value.trim() || 'http://localhost:3000/api');
    const res = await login(username.value.trim(), password.value);
    if (res.user.role !== 'BOSS') {
      uni.showToast({ title: '老板端仅支持老板账号登录', icon: 'none' });
      return;
    }
    uni.setStorageSync('token', res.accessToken);
    uni.setStorageSync('user', JSON.stringify(res.user));
    uni.reLaunch({ url: '/pages/index/index' });
  } catch {
    // 错误提示已由请求封装处理
  } finally {
    loading.value = false;
  }
}

function doLogout() {
  logout();
  password.value = '';
}
</script>

<template>
  <view class="login">
    <view class="logo-area">
      <text class="logo-icon">🏪</text>
      <text class="logo-title">文具店老板端</text>
      <text class="logo-sub">远程看店 · 采购审批 · 扫码盘点</text>
    </view>
    <view class="form">
      <view class="field">
        <text class="label">服务器地址</text>
        <input v-model="apiBase" class="ipt" placeholder="http://服务器IP:3000/api" />
      </view>
      <view class="field">
        <text class="label">账号</text>
        <input v-model="username" class="ipt" placeholder="老板账号" />
      </view>
      <view class="field">
        <text class="label">密码</text>
        <input v-model="password" class="ipt" password placeholder="密码" @confirm="doLogin" />
      </view>
      <button class="btn" :loading="loading" @click="doLogin">登 录</button>
      <view class="tips">
        <text>在外网使用请把云端 API 部署到公网，或在路由器做端口映射</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.login {
  min-height: 100vh;
  background: #2f3542;
  padding: 120rpx 48rpx 0;
}
.logo-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8rpx;
  margin-bottom: 64rpx;
}
.logo-icon {
  font-size: 88rpx;
}
.logo-title {
  color: #fff;
  font-size: 44rpx;
  font-weight: 700;
}
.logo-sub {
  color: #a4b0be;
  font-size: 24rpx;
}
.form {
  background: #fff;
  border-radius: 20rpx;
  padding: 40rpx 32rpx;
}
.field {
  margin-bottom: 28rpx;
}
.label {
  display: block;
  font-size: 26rpx;
  color: #57606f;
  margin-bottom: 10rpx;
}
.ipt {
  border: 1rpx solid #e1e4eb;
  border-radius: 12rpx;
  padding: 18rpx 20rpx;
  font-size: 28rpx;
}
.btn {
  margin-top: 16rpx;
  background: #4b7bec;
  color: #fff;
  font-size: 32rpx;
  border-radius: 44rpx;
}
.tips {
  margin-top: 24rpx;
  text-align: center;
  color: #a4b0be;
  font-size: 22rpx;
}
</style>
