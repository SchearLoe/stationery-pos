<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus, Search } from '@element-plus/icons-vue';
import { MEMBER_TXN_LABELS } from '@pos/shared-types';
import type { MemberDto, MemberTxnDto } from '@pos/shared-types';
import {
  adjustMember,
  createMember,
  listMembers,
  memberTxns,
  rechargeMember,
  updateMember,
} from '@/api';
import { fenToYuan, yuanToFen, money, formatDateTime } from '@/utils/money';

// ---------- 列表 ----------

const members = ref<MemberDto[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);
const loading = ref(false);
const keyword = ref('');

async function load() {
  loading.value = true;
  try {
    const res = await listMembers({
      page: page.value,
      pageSize: pageSize.value,
      ...(keyword.value.trim() ? { keyword: keyword.value.trim() } : {}),
    });
    members.value = res.items;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

// ---------- 新建 / 编辑 ----------

const formVisible = ref(false);
const form = ref({ id: '', name: '', phone: '', remark: '' });

function openCreate() {
  form.value = { id: '', name: '', phone: '', remark: '' };
  formVisible.value = true;
}

function openEdit(m: MemberDto) {
  form.value = { id: m.id, name: m.name, phone: m.phone ?? '', remark: m.remark ?? '' };
  formVisible.value = true;
}

async function save() {
  const f = form.value;
  if (!f.name.trim()) {
    ElMessage.warning('请填写会员姓名');
    return;
  }
  const data = { name: f.name.trim(), phone: f.phone || null, remark: f.remark || null };
  if (f.id) await updateMember(f.id, data);
  else await createMember(data);
  ElMessage.success('已保存');
  formVisible.value = false;
  void load();
}

async function toggleActive(m: MemberDto) {
  await ElMessageBox.confirm(
    m.active ? `停用后会员「${m.name}」将不能挂单消费。` : `恢复会员「${m.name}」？`,
    m.active ? '停用会员' : '恢复会员',
    { type: 'warning' },
  );
  await updateMember(m.id, { active: String(!m.active) });
  ElMessage.success('已更新');
  void load();
}

// ---------- 充值 ----------

const rechargeVisible = ref(false);
const rechargeTarget = ref<MemberDto | null>(null);
const rechargeAmount = ref('');
const rechargeBonus = ref('');
const rechargeMethod = ref<'CASH' | 'WECHAT' | 'ALIPAY' | 'CARD' | 'OTHER'>('CASH');
const rechargeNote = ref('');

function openRecharge(m: MemberDto) {
  rechargeTarget.value = m;
  rechargeAmount.value = '';
  rechargeBonus.value = '';
  rechargeMethod.value = 'CASH';
  rechargeNote.value = '';
  rechargeVisible.value = true;
}

async function confirmRecharge() {
  const m = rechargeTarget.value;
  if (!m) return;
  const amount = yuanToFen(rechargeAmount.value);
  const bonus = yuanToFen(rechargeBonus.value);
  if (amount <= 0) {
    ElMessage.warning('充值金额必须大于 0');
    return;
  }
  await rechargeMember(m.id, {
    amount,
    bonus: bonus > 0 ? bonus : undefined,
    method: rechargeMethod.value,
    note: rechargeNote.value || undefined,
  });
  ElMessage.success(`充值成功（${m.name}）`);
  rechargeVisible.value = false;
  void load();
}

// ---------- 调整 ----------

const adjustVisible = ref(false);
const adjustTarget = ref<MemberDto | null>(null);
const adjustBalance = ref('');
const adjustPoints = ref<number | undefined>(undefined);
const adjustNote = ref('');

function openAdjust(m: MemberDto) {
  adjustTarget.value = m;
  adjustBalance.value = '';
  adjustPoints.value = undefined;
  adjustNote.value = '';
  adjustVisible.value = true;
}

async function confirmAdjust() {
  const m = adjustTarget.value;
  if (!m) return;
  const balanceDelta = yuanToFen(adjustBalance.value);
  const pointsDelta = adjustPoints.value ?? 0;
  if (!balanceDelta && !pointsDelta) {
    ElMessage.warning('没有需要调整的项');
    return;
  }
  if (!adjustNote.value.trim()) {
    ElMessage.warning('请填写调整原因');
    return;
  }
  await adjustMember(m.id, {
    balanceDelta: balanceDelta || undefined,
    pointsDelta: pointsDelta || undefined,
    note: adjustNote.value.trim(),
  });
  ElMessage.success('已调整');
  adjustVisible.value = false;
  void load();
}

// ---------- 流水 ----------

const txnsVisible = ref(false);
const txns = ref<MemberTxnDto[]>([]);
const txnsTotal = ref(0);
const txnsPage = ref(1);
const txnsMember = ref<MemberDto | null>(null);

async function openTxns(m: MemberDto) {
  txnsMember.value = m;
  txnsPage.value = 1;
  txnsVisible.value = true;
  await loadTxns();
}

async function loadTxns() {
  if (!txnsMember.value) return;
  const res = await memberTxns(txnsMember.value.id, { page: txnsPage.value, pageSize: 30 });
  txns.value = res.items;
  txnsTotal.value = res.total;
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-input
        v-model="keyword"
        placeholder="姓名 / 手机号 / 会员码"
        clearable
        style="width: 220px"
        @keyup.enter="page = 1; load()"
      />
      <el-button type="primary" :icon="Search" @click="page = 1; load()">查询</el-button>
      <div class="spacer" />
      <el-button type="primary" :icon="Plus" @click="openCreate">新增会员</el-button>
    </div>

    <el-table v-loading="loading" :data="members" size="large">
      <el-table-column label="会员码" prop="code" width="100" />
      <el-table-column label="姓名" prop="name" width="110" />
      <el-table-column label="手机号" prop="phone" width="130" />
      <el-table-column label="储值余额" width="110" align="right">
        <template #default="{ row }">
          <span :class="{ 'balance-hot': row.balance > 0 }">{{ money(row.balance) }}</span>
        </template>
      </el-table-column>
      <el-table-column label="积分" prop="points" width="90" align="right" />
      <el-table-column label="状态" width="80" align="center">
        <template #default="{ row }">
          <el-tag :type="row.active ? 'success' : 'info'" size="small">{{ row.active ? '正常' : '停用' }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="150">
        <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="280" align="center">
        <template #default="{ row }">
          <el-button size="small" type="primary" @click="openRecharge(row)">充值</el-button>
          <el-button size="small" @click="openTxns(row)">流水</el-button>
          <el-button size="small" @click="openAdjust(row)">调整</el-button>
          <el-button size="small" text @click="openEdit(row)">编辑</el-button>
          <el-button size="small" text :type="row.active ? 'danger' : 'success'" @click="toggleActive(row)">
            {{ row.active ? '停用' : '恢复' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination
      v-model:current-page="page"
      :page-size="pageSize"
      :total="total"
      layout="total, prev, pager, next"
      class="pager"
      @current-change="load"
    />

    <!-- 新建/编辑 -->
    <el-dialog v-model="formVisible" :title="form.id ? '编辑会员' : '新增会员'" width="420px">
      <el-form label-width="70px">
        <el-form-item label="姓名">
          <el-input v-model="form.name" placeholder="必填" />
        </el-form-item>
        <el-form-item label="手机号">
          <el-input v-model="form.phone" placeholder="用于收银台快速挂单" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">取消</el-button>
        <el-button type="primary" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 充值 -->
    <el-dialog v-model="rechargeVisible" :title="rechargeTarget ? `会员充值 · ${rechargeTarget.name}` : ''" width="420px">
      <p v-if="rechargeTarget" class="tip">
        当前余额 {{ money(rechargeTarget.balance) }} · 积分 {{ rechargeTarget.points }}
      </p>
      <el-form label-width="80px">
        <el-form-item label="充值金额">
          <el-input v-model="rechargeAmount" size="large" placeholder="实收金额">
            <template #append>元</template>
          </el-input>
        </el-form-item>
        <el-form-item label="赠送金额">
          <el-input v-model="rechargeBonus" size="large" placeholder="选填，如充 100 送 20 填 20">
            <template #append>元</template>
          </el-input>
        </el-form-item>
        <el-form-item label="收款方式">
          <el-radio-group v-model="rechargeMethod">
            <el-radio-button value="CASH">现金</el-radio-button>
            <el-radio-button value="WECHAT">微信</el-radio-button>
            <el-radio-button value="ALIPAY">支付宝</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="rechargeNote" placeholder="选填" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="rechargeVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmRecharge">确认充值</el-button>
      </template>
    </el-dialog>

    <!-- 调整 -->
    <el-dialog v-model="adjustVisible" :title="adjustTarget ? `调整 · ${adjustTarget.name}` : ''" width="420px">
      <p v-if="adjustTarget" class="tip">当前余额 {{ money(adjustTarget.balance) }} · 积分 {{ adjustTarget.points }}（正数增加、负数减少）</p>
      <el-form label-width="90px">
        <el-form-item label="余额增减">
          <el-input v-model="adjustBalance" placeholder="元，如 -10.00">
            <template #append>元</template>
          </el-input>
        </el-form-item>
        <el-form-item label="积分增减">
          <el-input-number v-model="adjustPoints" :min="-999999" :max="999999" style="width: 160px" />
        </el-form-item>
        <el-form-item label="调整原因">
          <el-input v-model="adjustNote" placeholder="必填，如：充值错额更正" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="adjustVisible = false">取消</el-button>
        <el-button type="primary" @click="confirmAdjust">确认调整</el-button>
      </template>
    </el-dialog>

    <!-- 流水 -->
    <el-drawer v-model="txnsVisible" :title="txnsMember ? `会员流水 · ${txnsMember.name}（${txnsMember.code}）` : ''" size="640px">
      <el-table :data="txns" size="small">
        <el-table-column label="时间" width="140">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="类型" width="90" align="center">
          <template #default="{ row }">{{ MEMBER_TXN_LABELS[row.type as keyof typeof MEMBER_TXN_LABELS] }}</template>
        </el-table-column>
        <el-table-column label="余额变动" width="100" align="right">
          <template #default="{ row }">
            <span v-if="row.amount !== 0" :class="row.amount > 0 ? 'plus' : 'minus'">
              {{ row.amount > 0 ? '+' : '' }}{{ fenToYuan(row.amount) }}
            </span>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <el-table-column label="余额" width="90" align="right">
          <template #default="{ row }">{{ fenToYuan(row.balanceAfter) }}</template>
        </el-table-column>
        <el-table-column label="积分变动" width="90" align="right">
          <template #default="{ row }">
            <span v-if="row.pointsChange !== 0" :class="row.pointsChange > 0 ? 'plus' : 'minus'">
              {{ row.pointsChange > 0 ? '+' : '' }}{{ row.pointsChange }}
            </span>
            <span v-else class="dim">—</span>
          </template>
        </el-table-column>
        <el-table-column label="单号/说明" min-width="140">
          <template #default="{ row }">{{ row.note ?? row.refNo ?? '' }}</template>
        </el-table-column>
      </el-table>
      <el-pagination
        v-model:current-page="txnsPage"
        :page-size="30"
        :total="txnsTotal"
        layout="total, prev, pager, next"
        class="pager"
        @current-change="loadTxns"
      />
    </el-drawer>
  </div>
</template>

<style scoped>
.page {
  background: #fff;
  border-radius: 8px;
  padding: 16px;
}
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
}
.toolbar .spacer {
  flex: 1;
}
.pager {
  margin-top: 12px;
  justify-content: flex-end;
}
.balance-hot {
  color: #eb3b5a;
  font-weight: 600;
}
.tip {
  color: #57606f;
  font-size: 13px;
  margin-bottom: 10px;
}
.plus {
  color: #20bf6b;
}
.minus {
  color: #eb3b5a;
}
.dim {
  color: #a4b0be;
}
</style>
