<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { getApiBaseUrl, setApiBaseUrl, getSettings, updateSettings, listAuditLogs } from '@/api';
import { useAuthStore } from '@/stores/auth';
import { useSettingsStore } from '@/stores/settings';
import { printReceipt } from '@/services/print';
import type { SaleOrderDto } from '@pos/shared-types';
import { formatDateTime } from '@/utils/money';

const auth = useAuthStore();
const store = useSettingsStore();
const form = ref({ ...store.settings });
const saving = ref(false);
const windowHasBridge = computed(() => !!window.posApp);

// 打印设置（可选功能，默认全部关闭）
const printers = ref<string[]>([]);
const testPrinting = ref(false);

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

// ---------- 打印设置 ----------

async function loadPrinters() {
  if (!window.posApp) return;
  try {
    const list = await window.posApp.print.list();
    printers.value = list.map((p) => p.name);
    // 默认选中系统打印机
    if (!form.value.escposPrinterName) {
      const def = list.find((p) => p.isDefault);
      if (def) form.value.escposPrinterName = def.name;
    }
  } catch {
    // 非 Windows 或枚举失败：允许手输
  }
}

async function savePrint() {
  saving.value = true;
  try {
    store.settings = await updateSettings({
      receiptPrintingEnabled: form.value.receiptPrintingEnabled,
      autoPrintReceipt: form.value.autoPrintReceipt,
      escposDirectEnabled: form.value.escposDirectEnabled,
      escposPrinterName: form.value.escposPrinterName,
      receiptPaperWidth: form.value.receiptPaperWidth,
    });
    ElMessage.success('打印设置已保存');
  } finally {
    saving.value = false;
  }
}

const anyPrintEnabled = () =>
  form.value.receiptPrintingEnabled || (form.value.escposDirectEnabled && !!form.value.escposPrinterName);

/** 用一笔演示订单测试打印链路 */
async function testPrint() {
  if (!anyPrintEnabled()) {
    ElMessage.warning('请先开启任一打印方式并保存');
    return;
  }
  const demo: SaleOrderDto = {
    id: 'test',
    orderNo: 'T-测试打印',
    shiftId: null,
    cashierId: '',
    cashierName: auth.userName,
    status: 'NORMAL',
    items: [
      {
        id: 't1',
        skuId: 't1',
        productName: '晨光中性笔 K35',
        spec: '黑色 0.5mm',
        barcode: '6901234567892',
        unit: '支',
        qty: 2,
        unitPrice: 250,
        subtotal: 500,
        refundedQty: 0,
      },
      {
        id: 't2',
        skuId: 't2',
        productName: '软抄本B5',
        spec: null,
        barcode: null,
        unit: '本',
        qty: 1,
        unitPrice: 350,
        subtotal: 350,
        refundedQty: 0,
      },
    ],
    payments: [{ id: 'tp1', method: 'CASH', amount: 850 }],
    totalAmount: 850,
    discountAmount: 0,
    payableAmount: 850,
    remark: null,
    voidReason: null,
    createdAt: new Date().toISOString(),
  };
  testPrinting.value = true;
  try {
    const result = await printReceipt(demo, auth.userName);
    if (result.ok) ElMessage.success(result.message);
    else ElMessage.error(result.message);
  } finally {
    testPrinting.value = false;
  }
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
  if (auth.isBoss) {
    void loadLogs();
    void loadPrinters();
  }
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
        <el-form-item label="会员积分赠送">
          <el-input-number v-model="form.memberPointsPerYuan" :min="0" :max="100" />
          <span class="hint">积分/元（消费 1 元送 N 积分，0 = 不送）</span>
        </el-form-item>
        <el-form-item label="积分抵扣价值">
          <el-input-number v-model="form.memberPointValueCent" :min="1" :max="100" />
          <span class="hint">分/积分（1 分 = 1 积分抵 0.01 元）</span>
        </el-form-item>
      </el-form>
      <el-button v-if="auth.isBoss" type="primary" :loading="saving" @click="save">保存设置</el-button>
      <el-alert v-else title="仅老板可修改设置" type="info" :closable="false" style="width: 300px" />
    </el-card>

    <el-card style="margin-top: 14px">
      <template #header>打印设置（可选功能，不开也不影响收款）</template>
      <el-form label-width="150px" style="max-width: 680px">
        <el-form-item label="驱动打印小票">
          <el-switch v-model="form.receiptPrintingEnabled" />
          <span class="hint">经 Windows 打印机驱动输出，需安装小票机厂商驱动</span>
        </el-form-item>
        <el-form-item label="ESC/POS 直连打印">
          <el-switch v-model="form.escposDirectEnabled" />
          <span class="hint">指令直送打印机字库，速度快；仅支持本机已安装的打印机</span>
        </el-form-item>
        <el-form-item label="直连打印机">
          <el-select
            v-model="form.escposPrinterName"
            filterable
            allow-create
            default-first-option
            placeholder="选择或输入打印机名"
            style="width: 320px"
            :disabled="!form.escposDirectEnabled"
          >
            <el-option v-for="name in printers" :key="name" :value="name" :label="name" />
          </el-select>
        </el-form-item>
        <el-form-item label="小票纸宽">
          <el-radio-group v-model="form.receiptPaperWidth">
            <el-radio-button :value="58">58mm</el-radio-button>
            <el-radio-button :value="80">80mm</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="收款后自动打印">
          <el-switch v-model="form.autoPrintReceipt" :disabled="!anyPrintEnabled()" />
          <span class="hint">开启后每单收款完成自动静默打印（驱动打印模式下）</span>
        </el-form-item>
        <el-form-item v-if="!windowHasBridge" label="">
          <el-alert type="warning" :closable="false" title="打印功能仅在桌面端（Electron 收银机应用）中可用" />
        </el-form-item>
      </el-form>
      <div style="display: flex; gap: 10px">
        <el-button type="primary" :loading="saving" :disabled="!auth.isBoss" @click="savePrint">保存打印设置</el-button>
        <el-button :loading="testPrinting" :disabled="!anyPrintEnabled()" @click="testPrint">测试打印</el-button>
      </div>
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
