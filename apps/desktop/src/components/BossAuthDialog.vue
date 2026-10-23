<script setup lang="ts">
/**
 * 老板授权弹窗：收银员执行受限操作（低于最低价改价/超限折扣等）时，
 * 由老板在本机输入自己的账号密码完成授权。
 */
import { ref, watch } from 'vue';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{ visible: boolean; title?: string }>();
const emit = defineEmits<{ (e: 'update:visible', v: boolean): void; (e: 'granted', bossName: string): void }>();

const auth = useAuthStore();
const username = ref(auth.isBoss ? auth.user?.username ?? '' : 'boss');
const password = ref('');
const loading = ref(false);

watch(
  () => props.visible,
  (v) => {
    if (v) password.value = '';
  },
);

async function grant() {
  if (!password.value) {
    ElMessage.warning('请输入密码');
    return;
  }
  loading.value = true;
  try {
    const name = await auth.authorizeBoss(username.value.trim(), password.value);
    ElMessage.success(`已获授权（${name}）`);
    emit('granted', name);
    emit('update:visible', false);
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '授权失败');
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <el-dialog
    :model-value="visible"
    :title="title ?? '需要老板授权'"
    width="400px"
    @update:model-value="emit('update:visible', $event)"
  >
    <el-form @submit.prevent="grant">
      <el-form-item label="老板账号">
        <el-input v-model="username" placeholder="boss" />
      </el-form-item>
      <el-form-item label="密码">
        <el-input v-model="password" type="password" show-password placeholder="老板密码" @keyup.enter="grant" />
      </el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="emit('update:visible', false)">取消</el-button>
      <el-button type="primary" :loading="loading" @click="grant">授权</el-button>
    </template>
  </el-dialog>
</template>
