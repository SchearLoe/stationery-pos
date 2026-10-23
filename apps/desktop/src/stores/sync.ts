/**
 * 离线同步中心：网络状态、outbox 待同步队列的自动补传与手工管理。
 * 网络错误 → 暂停等待下次重试；业务错误（如商品已删除）→ 标记失败等人工处理。
 */
import { defineStore } from 'pinia';
import { createSaleOrder } from '@/api';
import { useAuthStore } from '@/stores/auth';
import {
  isNetworkError,
  listOutbox,
  patchOutboxSale,
  removeFromOutbox,
  type OutboxSale,
} from '@/services/outbox';
import { refreshCatalogCache } from '@/services/catalog-cache';

const FLUSH_INTERVAL_MS = 30 * 1000;

export const useSyncStore = defineStore('sync', {
  state: () => ({
    online: navigator.onLine,
    pendingCount: 0,
    failedCount: 0,
    syncing: false,
    lastSyncAt: null as number | null,
    items: [] as OutboxSale[],
    timer: 0 as ReturnType<typeof setInterval> | 0,
    started: false,
  }),
  actions: {
    async init() {
      if (this.started) return;
      this.started = true;
      window.addEventListener('online', () => {
        this.online = true;
        void this.flush();
      });
      window.addEventListener('offline', () => {
        this.online = false;
      });
      setInterval(() => {
        if (this.online && !this.syncing) void this.flush();
      }, FLUSH_INTERVAL_MS);
      await this.refresh();
      // 回连后立即补传一次 + 刷新商品缓存
      if (this.online && !this.syncing) void this.flush();
      void refreshCatalogCache();
    },
    async refresh() {
      const list = await listOutbox();
      this.items = list;
      this.pendingCount = list.filter((s) => s.status === 'PENDING').length;
      this.failedCount = list.filter((s) => s.status === 'FAILED').length;
    },
    /** 顺序补传：网络错误即停；业务错误标记 FAILED 继续下一单 */
    async flush(): Promise<{ synced: number }> {
      if (this.syncing) return { synced: 0 };
      this.syncing = true;
      let synced = 0;
      try {
        const queue = (await listOutbox())
          .filter((s) => s.status === 'PENDING')
          .sort((a, b) => a.createdAt - b.createdAt);
        for (const sale of queue) {
          if (!navigator.onLine) break;
          try {
            await createSaleOrder(sale.payload);
            await removeFromOutbox(sale.clientId);
            synced++;
          } catch (e) {
            if (isNetworkError(e)) break; // 仍然离线，等下轮
            await patchOutboxSale(sale.clientId, {
              status: 'FAILED',
              failedReason: e instanceof Error ? e.message : '同步失败',
            });
          }
        }
        if (synced > 0) this.lastSyncAt = Date.now();
      } finally {
        this.syncing = false;
        await this.refresh();
      }
      return { synced };
    },
    /** 失败单重试（修正服务端数据后） */
    async retry(clientId: string): Promise<void> {
      const list = await listOutbox();
      const sale = list.find((s) => s.clientId === clientId);
      if (!sale) return;
      await patchOutboxSale(clientId, { status: 'PENDING', failedReason: undefined });
      await this.flush();
    },
    /** 删除失败单（仅限已确认不需要入账的单据，需谨慎） */
    async removeFailed(clientId: string): Promise<void> {
      const list = await listOutbox();
      const sale = list.find((s) => s.clientId === clientId);
      if (!sale || sale.status !== 'FAILED') return;
      await removeFromOutbox(clientId);
      await this.refresh();
    },
  },
});
