<script setup lang="ts">
import type { SaleOrderDto } from '@pos/shared-types';
import { PAYMENT_METHOD_LABELS } from '@pos/shared-types';
import { fenToYuan, formatDateTime } from '@/utils/money';
import { useSettingsStore } from '@/stores/settings';

const props = defineProps<{ order: SaleOrderDto; cashierName?: string }>();
const settings = useSettingsStore();

function print() {
  window.print();
}

defineExpose({ print });
void props;
</script>

<template>
  <div id="receipt-area" class="receipt">
    <div class="shop-name">{{ settings.settings.storeName }}</div>
    <div class="shop-info" v-if="settings.settings.storePhone">{{ settings.settings.storePhone }}</div>
    <div class="shop-info" v-if="settings.settings.storeAddress">{{ settings.settings.storeAddress }}</div>
    <div class="divider">--------------------------------</div>
    <div class="row"><span>单号：</span><span>{{ order.orderNo }}</span></div>
    <div class="row"><span>时间：</span><span>{{ formatDateTime(order.createdAt) }}</span></div>
    <div class="row"><span>收银：</span><span>{{ cashierName ?? order.cashierName ?? '' }}</span></div>
    <div class="divider">--------------------------------</div>
    <div v-for="item in order.items" :key="item.id" class="item">
      <div class="item-name">{{ item.productName }}<template v-if="item.spec"> {{ item.spec }}</template></div>
      <div class="row">
        <span>{{ fenToYuan(item.unitPrice) }} × {{ item.qty }}{{ item.unit }}</span>
        <span>{{ fenToYuan(item.subtotal) }}</span>
      </div>
    </div>
    <div class="divider">--------------------------------</div>
    <div class="row"><span>合计：</span><span>{{ fenToYuan(order.totalAmount) }}</span></div>
    <div class="row" v-if="order.discountAmount > 0"><span>优惠：</span><span>-{{ fenToYuan(order.discountAmount) }}</span></div>
    <div class="row total"><span>实收：</span><span>¥{{ fenToYuan(order.payableAmount) }}</span></div>
    <div class="row" v-for="p in order.payments" :key="p.id">
      <span>{{ PAYMENT_METHOD_LABELS[p.method] }}：</span><span>{{ fenToYuan(p.amount) }}</span>
    </div>
    <div class="divider">--------------------------------</div>
    <div class="footer">{{ settings.settings.receiptFooter }}</div>
  </div>
</template>

<style scoped>
.receipt {
  background: #fff;
  font-family: 'SimSun', 'Courier New', monospace;
  font-size: 12px;
  color: #000;
  padding: 8px;
  width: 230px;
}
.shop-name {
  text-align: center;
  font-size: 16px;
  font-weight: bold;
}
.shop-info {
  text-align: center;
  font-size: 11px;
}
.divider {
  white-space: nowrap;
  overflow: hidden;
  margin: 4px 0;
}
.row {
  display: flex;
  justify-content: space-between;
  line-height: 1.7;
}
.item-name {
  line-height: 1.5;
}
.total {
  font-weight: bold;
  font-size: 14px;
}
.footer {
  text-align: center;
  margin-top: 4px;
}
</style>
