import { defineStore } from 'pinia';

export interface CartItem {
  skuId: string;
  productName: string;
  spec: string | null;
  barcode: string | null;
  unit: string;
  qty: number;
  /** 成交单价（分），可与零售价不同 */
  unitPrice: number;
  retailPrice: number;
  minPrice: number | null;
  /** 会员价（分），挂会员后一键应用 */
  memberPrice?: number | null;
  /** 单价是否由「挂会员自动应用会员价」改写（解除挂会员时只恢复这些行） */
  memberApplied?: boolean;
  stockQty: number;
}

export interface HoldOrder {
  savedAt: number;
  items: CartItem[];
}

/** 单行数量上限，防误触 */
export const MAX_QTY_PER_LINE = 999;

export const useCartStore = defineStore('cart', {
  state: () => ({
    items: [] as CartItem[],
    holds: [] as HoldOrder[],
    /** 整单折扣金额（分） */
    discountAmount: 0,
  }),
  getters: {
    count: (s) => s.items.reduce((n, i) => n + i.qty, 0),
    lineCount: (s) => s.items.length,
    total: (s) => s.items.reduce((n, i) => n + i.qty * i.unitPrice, 0),
    payable(): number {
      return Math.max(0, this.total - this.discountAmount);
    },
    isEmpty: (s) => s.items.length === 0,
  },
  actions: {
    add(item: Omit<CartItem, 'qty'>, qty = 1) {
      const exist = this.items.find((i) => i.skuId === item.skuId);
      if (exist) {
        exist.qty = Math.min(MAX_QTY_PER_LINE, exist.qty + qty);
      } else {
        this.items.push({ ...item, qty: Math.min(MAX_QTY_PER_LINE, qty) });
      }
    },
    setQty(skuId: string, qty: number) {
      const item = this.items.find((i) => i.skuId === skuId);
      if (!item) return;
      if (qty <= 0) this.remove(skuId);
      else item.qty = Math.min(MAX_QTY_PER_LINE, Math.floor(qty));
    },
    setPrice(skuId: string, price: number) {
      const item = this.items.find((i) => i.skuId === skuId);
      if (!item) return;
      if (price < 0) return;
      item.unitPrice = Math.round(price);
    },
    remove(skuId: string) {
      this.items = this.items.filter((i) => i.skuId !== skuId);
    },
    clear() {
      this.items = [];
      this.discountAmount = 0;
    },
    hold() {
      if (this.isEmpty) return false;
      this.holds.push({ savedAt: Date.now(), items: [...this.items] });
      this.clear();
      return true;
    },
    recall(index: number) {
      const hold = this.holds[index];
      if (!hold) return false;
      this.items = hold.items;
      this.discountAmount = 0;
      this.holds.splice(index, 1);
      return true;
    },
  },
});
