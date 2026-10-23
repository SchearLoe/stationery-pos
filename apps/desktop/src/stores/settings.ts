import { defineStore } from 'pinia';
import { getSettings } from '@/api';
import type { StoreSettings } from '@pos/shared-types';

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    settings: {
      storeName: '我的文具店',
      storePhone: '',
      storeAddress: '',
      receiptFooter: '谢谢惠顾，欢迎再次光临',
      allowNegativeStock: true,
      cashierMinDiscountPercent: 95,
      cashierCanRefund: true,
    } as StoreSettings,
    loaded: false,
  }),
  actions: {
    async load(force = false) {
      if (this.loaded && !force) return this.settings;
      this.settings = await getSettings();
      this.loaded = true;
      return this.settings;
    },
  },
});
