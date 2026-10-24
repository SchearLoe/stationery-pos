import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { StocktakeService } from './stocktake.service';

function makePrismaMock() {
  const prisma: any = {};
  prisma.$transaction = jest.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));
  prisma.stocktakeTask = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  prisma.stocktakeItem = { update: jest.fn() };
  prisma.sku = { findMany: jest.fn(), update: jest.fn() };
  prisma.inventory = { upsert: jest.fn() };
  prisma.inventoryLog = { create: jest.fn() };
  return prisma;
}

const boss = { id: 'boss-1', role: 'BOSS' as const };
const cashier = { id: 'c-1', role: 'CASHIER' as const };
const audit = { log: jest.fn().mockResolvedValue(undefined) };

/** getTask 的详情查询返回（含 sku.barcodes） */
function detailTask(over: Record<string, unknown> = {}) {
  return {
    id: 't1',
    taskNo: 'T20260101-AAAA',
    status: 'OPEN',
    scopeCategoryId: null,
    scopeCategory: null,
    note: null,
    creator: { name: '老板' },
    appliedAt: null,
    createdAt: new Date(),
    items: [
      { id: 'a', skuId: 's1', productName: '笔', spec: '黑', unit: '支', snapshotQty: 5, countedQty: 3, sku: { barcodes: [] } },
      { id: 'b', skuId: 's2', productName: '本', spec: null, unit: '本', snapshotQty: 5, countedQty: null, sku: { barcodes: [] } },
      { id: 'c', skuId: 's3', productName: '尺', spec: null, unit: '把', snapshotQty: 2, countedQty: 2, sku: { barcodes: [] } },
    ],
    ...over,
  };
}

describe('StocktakeService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: StocktakeService;

  beforeEach(() => {
    prisma = makePrismaMock();
    audit.log.mockClear();
    service = new StocktakeService(prisma, audit as never);
  });

  it('收银员不能操作盘点', async () => {
    await expect(service.create(cashier, {})).rejects.toThrow(ForbiddenException);
    await expect(service.apply(cashier, 't1')).rejects.toThrow(ForbiddenException);
  });

  describe('apply（应用盘点差异）', () => {
    it('只调整「已录入且有差异」的项，未盘项不动', async () => {
      prisma.stocktakeTask.findUnique
        .mockResolvedValueOnce(detailTask()) // apply 取单
        .mockResolvedValueOnce(detailTask({ status: 'APPLIED', appliedAt: new Date() })); // getTask 详情
      prisma.inventory.upsert.mockResolvedValue({ qty: 3 });
      prisma.inventoryLog.create.mockResolvedValue({});
      prisma.stocktakeTask.update.mockResolvedValue({});

      await service.apply(boss, 't1');

      // 只有 a（5→3）被调整
      expect(prisma.inventory.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.inventory.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { skuId: 's1' },
          create: { skuId: 's1', qty: 3 },
          update: { qty: 3 },
        }),
      );
      expect(prisma.inventoryLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'STOCKTAKE', change: -2, after: 3, refNo: 'T20260101-AAAA' }),
        }),
      );
      expect(prisma.stocktakeTask.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'APPLIED' }) }),
      );
    });

    it('没有差异时报错提示', async () => {
      const noDiff = detailTask({
        items: [
          { id: 'a', skuId: 's1', productName: '笔', spec: null, unit: '支', snapshotQty: 5, countedQty: 5, sku: { barcodes: [] } },
          { id: 'b', skuId: 's2', productName: '本', spec: null, unit: '本', snapshotQty: 5, countedQty: null, sku: { barcodes: [] } },
        ],
      });
      prisma.stocktakeTask.findUnique.mockResolvedValue(noDiff);
      await expect(service.apply(boss, 't1')).rejects.toThrow(/没有可应用的差异/);
    });

    it('已结束的任务不能再次应用', async () => {
      prisma.stocktakeTask.findUnique.mockResolvedValue(detailTask({ status: 'APPLIED' }));
      await expect(service.apply(boss, 't1')).rejects.toThrow(/已结束/);
    });
  });

  describe('saveCounts', () => {
    it('非 OPEN 状态不能再录入', async () => {
      prisma.stocktakeTask.findUnique.mockResolvedValue({
        id: 't1',
        status: 'APPLIED',
        items: [{ id: 'a' }],
      });
      await expect(
        service.saveCounts(boss, 't1', { items: [{ id: 'a', countedQty: 1 }] }),
      ).rejects.toThrow(/不能再录入/);
    });

    it('录入项不在本任务内时被忽略', async () => {
      prisma.stocktakeTask.findUnique.mockResolvedValue({
        id: 't1',
        status: 'OPEN',
        items: [{ id: 'a' }, { id: 'b' }],
      });
      prisma.stocktakeItem.update.mockResolvedValue({});
      prisma.stocktakeTask.findUnique.mockResolvedValueOnce({
        id: 't1',
        status: 'OPEN',
        items: [{ id: 'a' }, { id: 'b' }],
      });
      prisma.stocktakeTask.findUnique.mockResolvedValueOnce(detailTask());
      await service.saveCounts(boss, 't1', {
        items: [
          { id: 'a', countedQty: 4 },
          { id: 'outsider', countedQty: 99 },
        ],
      });
      expect(prisma.stocktakeItem.update).toHaveBeenCalledTimes(1);
      expect(prisma.stocktakeItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'a' }, data: { countedQty: 4 } }),
      );
    });
  });
});
