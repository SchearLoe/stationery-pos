<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { createUser, listUsers, updateUser } from '@/api';
import { formatDateTime } from '@/utils/money';

interface UserRow {
  id: string;
  username: string;
  name: string;
  role: 'BOSS' | 'CASHIER';
  active: boolean;
  createdAt: string;
}

const users = ref<UserRow[]>([]);
const createVisible = ref(false);
const form = ref({ username: '', password: '', name: '', role: 'CASHIER' });
const saving = ref(false);

async function load() {
  users.value = await listUsers();
}

onMounted(load);

async function doCreate() {
  if (!form.value.username.trim() || form.value.password.length < 6) {
    ElMessage.warning('用户名必填，密码至少 6 位');
    return;
  }
  saving.value = true;
  try {
    await createUser({
      username: form.value.username.trim(),
      password: form.value.password,
      name: form.value.name || form.value.username,
      role: form.value.role,
    });
    ElMessage.success('已创建');
    createVisible.value = false;
    form.value = { username: '', password: '', name: '', role: 'CASHIER' };
    await load();
  } finally {
    saving.value = false;
  }
}

async function toggleActive(u: UserRow) {
  await updateUser(u.id, { active: !u.active });
  ElMessage.success(u.active ? '已停用' : '已启用');
  await load();
}

async function resetPassword(u: UserRow) {
  const { value } = await ElMessageBox.prompt(`为「${u.name}」设置新密码（至少 6 位）：`, '重置密码', {
    inputPattern: /^.{6,}$/,
    inputErrorMessage: '密码至少 6 位',
  });
  await updateUser(u.id, { password: value });
  ElMessage.success('密码已重置');
}

async function changeRole(u: UserRow) {
  const next = u.role === 'BOSS' ? 'CASHIER' : 'BOSS';
  await updateUser(u.id, { role: next });
  ElMessage.success(`已改为${next === 'BOSS' ? '老板' : '收银员'}`);
  await load();
}
</script>

<template>
  <el-card>
    <div class="toolbar">
      <span>员工账号（离职员工请停用而非删除，以保留其单据归属）</span>
      <div class="spacer" />
      <el-button type="primary" @click="createVisible = true">新增账号</el-button>
    </div>
    <el-table :data="users" stripe>
      <el-table-column label="用户名" prop="username" width="160" />
      <el-table-column label="姓名" prop="name" width="160" />
      <el-table-column label="角色" width="120" align="center">
        <template #default="{ row }">
          <el-tag :type="row.role === 'BOSS' ? 'danger' : 'primary'">{{ row.role === 'BOSS' ? '老板' : '收银员' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100" align="center">
        <template #default="{ row }">
          <el-tag :type="row.active ? 'success' : 'info'">{{ row.active ? '启用' : '停用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="180">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column min-width="240" align="center">
        <template #default="{ row }">
          <el-button size="small" @click="changeRole(row)">切换角色</el-button>
          <el-button size="small" @click="resetPassword(row)">重置密码</el-button>
          <el-button size="small" :type="row.active ? 'danger' : 'success'" plain @click="toggleActive(row)">
            {{ row.active ? '停用' : '启用' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </el-card>

  <el-dialog v-model="createVisible" title="新增账号" width="420px">
    <el-form :model="form" label-width="80px">
      <el-form-item label="用户名" required>
        <el-input v-model="form.username" placeholder="登录用，如 xiaoli" />
      </el-form-item>
      <el-form-item label="姓名">
        <el-input v-model="form.name" placeholder="显示名，如 小李" />
      </el-form-item>
      <el-form-item label="密码" required>
        <el-input v-model="form.password" type="password" show-password placeholder="至少 6 位" />
      </el-form-item>
      <el-form-item label="角色">
        <el-radio-group v-model="form.role">
          <el-radio value="CASHIER">收银员</el-radio>
          <el-radio value="BOSS">老板</el-radio>
        </el-radio-group>
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="createVisible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="doCreate">创建</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  color: #57606f;
  margin-bottom: 12px;
}
.spacer {
  flex: 1;
}
</style>
