<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { User, Lock } from '@element-plus/icons-vue';
import { useAuthStore } from '@/stores/auth';

const router = useRouter();
const auth = useAuthStore();
const username = ref('');
const password = ref('');
const loading = ref(false);

async function submit() {
  if (!username.value || !password.value) {
    ElMessage.warning('请输入用户名和密码');
    return;
  }
  loading.value = true;
  try {
    await auth.login(username.value.trim(), password.value);
    ElMessage.success(`欢迎，${auth.userName}`);
    void router.push('/register');
  } catch {
    // 错误提示由 axios 拦截器统一处理
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-wrap">
    <el-card class="login-card">
      <div class="login-title">
        <h2>文具店收银系统</h2>
        <p>Stationery POS</p>
      </div>
      <el-form @submit.prevent="submit">
        <el-form-item>
          <el-input v-model="username" placeholder="用户名" size="large" :prefix-icon="User" autofocus />
        </el-form-item>
        <el-form-item>
          <el-input
            v-model="password"
            type="password"
            placeholder="密码"
            size="large"
            :prefix-icon="Lock"
            show-password
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-button type="primary" size="large" style="width: 100%" :loading="loading" @click="submit">
          登 录
        </el-button>
      </el-form>
      <div class="login-hint">首次使用请先用数据库种子账号登录（boss / boss123）</div>
    </el-card>
  </div>
</template>

<style scoped>
.login-wrap {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(135deg, #4b7bec 0%, #3867d6 100%);
}
.login-card {
  width: 380px;
  padding: 8px 12px;
}
.login-title {
  text-align: center;
  margin-bottom: 20px;
}
.login-title h2 {
  margin: 0;
  color: #2f3542;
}
.login-title p {
  margin: 4px 0 0;
  color: #a4b0be;
  letter-spacing: 2px;
}
.login-hint {
  margin-top: 14px;
  font-size: 12px;
  color: #a4b0be;
  text-align: center;
}
</style>
