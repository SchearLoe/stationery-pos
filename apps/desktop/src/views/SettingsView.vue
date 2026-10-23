<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { getApiBaseUrl, setApiBaseUrl, getSettings, updateSettings, listAuditLogs } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useSettingsStore } from '@/stores/settings';
import { formatDateTime } from '@/utils/money';

const auth = useAuthStore();
const store = useSettingsStore();
const form = ref({ ...store.settings });
const saving = ref(false);

// 服务器地址
const apiBase = ref(getApiBaseUrl());

// 审计日志
const logs = ref<Awaited<ReturnType<typeof listAuditLogs>>['items']>([]);
const logTotal = ref(0);
const logPage = ref(1);

async function loadLogs() {
  const result = await listAuditLogs({ page: logPage.value, pageSize: 30 });
  logs.value = result.items;
  logTotal.value = result.total;
}

async function save() {
  saving.value = true;
  try {
    store.settings = await updateSettings({ ...form.value });
    ElMessage.success('已保存');
  } finally {
    saving.value = false;
  }
}

async function saveApiBase() {
  setApiBaseUrl(apiBase.value.trim());
  ElMessage.success('服务器地址已保存，即将重新验证…');
  try {
    store.settings = await getSettings();
    store.loaded = true;
    ElMessage.success('连接成功');
  } catch {
    ElMessage.error('无法连接服务器，请检查地址与网络');
  }
}

onMounted(() => {
  if (auth.isBoss) void loadLogs();
});
</script>

<template>
  <div>
    <el-card>
      <template #header>店铺与小票</template>
      <el-form :model="form" label-width="130px" style="max-width: 560px">
        <el-form-item label="店铺名称">
          <el-input v-model="form.storeName" />
        </el-form-item>
        <el-form-item label="电话">
          <el-input v-model="form.storePhone" />
        </el-form-item>
        <el-form-item label="地址">
          <el-input v-model="form.storeAddress" />
        </el-form-item>
        <el-form-item label="小票页脚广告语">
          <el-input v-model="form.receiptFooter" placeholder="如：开学季全场笔类 9 折" />
        </el-form-item>
      </el-form>
    </el-card>

    <el-card style="margin-top: 14px">
      <template #header>业务规则</template>
      <el-form :model="form" label-width="130px" style="max-width: 560px">
        <el-form-item label="允许负库存销售">
          <el-switch v-model="form.allowNegativeStock" />
          <span class="hint">文具店常见「先卖后补录」，开启后库存不足也可收款</span>
        </el-form-item>
        <el-form-item label="收银员折扣下限">
          <el-input-number v-model="form.cashierMinDiscountPercent" :min="50" :max="100" />
          <span class="hint">%（95 = 收银员整单最低 95 折，超出需老板授权）</span>
        </el-form-item>
        <el-form-item label="允许收银员退货">
          <el-switch v-model="form.cashierCanRefund" />
        </el-form-item>
      </el-form>
      <el-button v-if="auth.isBoss" type="primary" :loading="saving" @click="save">保存设置</el-button>
      <el-alert v-else title="仅老板可修改设置" type="info" :closable="false" style="width: 300px" />
    </el-card>

    <el-card style="margin-top: 14px">
      <template #header>服务器地址（本机连接的云端 API）</template>
      <div style="display: flex; gap: 10px; max-width: 560px">
        <el-input v-model="apiBase" placeholder="http://your-server:3000/api" />
        <el-button @click="saveApiBase">保存并测试</el-button>
      </div>
    </el-card>

    <el-card v-if="auth.isBoss" style="margin-top: 14px">
      <template #header>操作审计日志（不可删除）</template>
      <el-table :data="logs" size="small" stripe>
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作人" width="110" prop="user.name" />
        <el-table-column label="动作" prop="action" width="170" />
        <el-table-column label="对象" prop="target" width="170" />
        <el-table-column label="详情" min-width="220">
          <template #default="{ row }">
            <span class="detail-json">{{ row.detail ? JSON.stringify(row.detail) : '' }}</span>
          </template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-model:current-page="logPage"
        :page-size="30"
        :total="logTotal"
        layout="total, prev, pager, next"
        style="margin-top: 12px; justify-content: flex-end"
        @current-change="loadLogs"
      />
    </el-card>
  </div>
</template>

<style scoped>
.hint {
  color: #a4b0be;
  font-size: 12px;
  margin-left: 10px;
}
.detail-json {
  font-size: 12px;
  color: #a4b0be;
  word-break: break-all;
}
</style>
