import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PurchasesService } from './purchases.service';

/** 构造一个支持 $transaction(fn) 直调的 Prisma mock */
function makePrismaMock() {
  const prisma: any = {};
  prisma.$transaction = jest.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));
  prisma.supplier = {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };
  prisma.purchaseOrder = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    aggregate: jest.fn(),
  };
  prisma.purchaseItem = {
    update: jest.fn(),
  };
  prisma.purchasePayment = {
    create: jest.fn(),
    findMany: jest.fn(),
    aggregate: jest.fn(),
  };
  prisma.sku = {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  };
  prisma.inventory = { upsert: jest.fn() };
  prisma.inventoryLog = { create: jest.fn() };
  return prisma;
}

const boss = { id: 'boss-1', role: 'BOSS' as const };
const cashier = { id: 'c-1', role: 'CASHIER' as const };
const audit = { log: jest.fn().mockResolvedValue(undefined) };

describe('PurchasesService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: PurchasesService;

  beforeEach(() => {
    prisma = makePrismaMock();
    audit.log.mockClear();
    service = new PurchasesService(prisma, audit as never);
  });

  describe('权限', () => {
    it('收银员不能创建采购单', async () => {
      await expect(
        service.createOrder(cashier, { supplierId: 's1', items: [{ skuId: 'k1', qty: 1, unitCost: 100 }] }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('收银员不能看应付汇总', async () => {
      await expect(service.payables(cashier)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('createOrder', () => {
    it('合计金额 = 数量 × 进价，初始状态 DRAFT', async () => {
      prisma.supplier.findFirst.mockResolvedValue({ id: 's1', name: '晨光', active: true });
      prisma.sku.findMany.mockResolvedValue([
        {
          id: 'k1',
          spec: '黑色',
          product: { name: '中性笔', unit: '支' },
          barcodes: [{ barcode: '6901234567892' }],
        },
      ]);
      prisma.purchaseOrder.create.mockResolvedValue({ id: 'po1', orderNo: 'P20260101-AAAA' });
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po1',
        orderNo: 'P20260101-AAAA',
        status: 'DRAFT',
        totalAmount: 1500,
        remark: null,
        receivedAt: null,
        createdAt: new Date(),
        supplier: { name: '晨光' },
        operator: { name: '老板' },
        items: [{ id: 'i1', skuId: 'k1', productName: '中性笔', spec: '黑色', barcode: '6901234567892', unit: '支', qty: 3, receivedQty: 0, unitCost: 500, subtotal: 1500 }],
        payments: [],
      });

      const result = await service.createOrder(boss, {
        supplierId: 's1',
        items: [{ skuId: 'k1', qty: 3, unitCost: 500 }],
      });

      expect(prisma.purchaseOrder.create).toHaveBeenCalled();
      const data = prisma.purchaseOrder.create.mock.calls[0][0].data;
      expect(data.totalAmount).toBe(1500);
      expect(data.status).toBe('DRAFT');
      // 应付口径 = 已入库金额 − 已付：新建单未入库，应付余额为 0
      expect(result.receivedAmount).toBe(0);
      expect(result.payableAmount).toBe(0);
    });

    it('包含已删除的 SKU 时报错', async () => {
      prisma.supplier.findFirst.mockResolvedValue({ id: 's1', active: true });
      prisma.sku.findMany.mockResolvedValue([]);
      await expect(
        service.createOrder(boss, { supplierId: 's1', items: [{ skuId: 'gone', qty: 1, unitCost: 100 }] }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('receive（采购入库）', () => {
    const order = {
      id: 'po1',
      orderNo: 'P20260101-AAAA',
      status: 'DRAFT',
      totalAmount: 500,
      supplier: { name: '晨光' },
      items: [{ id: 'i1', skuId: 'k1', qty: 5, receivedQty: 0, unitCost: 100 }],
    };

    it('入库：库存增加、成本按移动加权平均更新、全部收齐置 RECEIVED', async () => {
      prisma.purchaseOrder.findUnique
        // receive 内第一次：取单
        .mockResolvedValueOnce(order)
        // 事务内第二次：判断是否全部收齐
        .mockResolvedValueOnce({ ...order, items: [{ qty: 5, receivedQty: 5 }] })
        // getOrder 内第三次：取详情
        .mockResolvedValueOnce({
          ...order,
          status: 'RECEIVED',
          remark: null,
          receivedAt: new Date(),
          createdAt: new Date(),
          supplier: { name: '晨光' },
          operator: null,
          items: [],
          payments: [],
        });
      // 账面库存 10 件、均价 1200 分；进 5 件 @100 分
      prisma.sku.findUnique.mockResolvedValue({
        id: 'k1',
        costAvg: 1200,
        inventory: { qty: 10 },
      });
      prisma.inventory.upsert.mockResolvedValue({ qty: 15 });
      prisma.inventoryLog.create.mockResolvedValue({});
      prisma.sku.update.mockResolvedValue({});
      prisma.purchaseItem.update.mockResolvedValue({});
      prisma.purchaseOrder.update.mockResolvedValue({});

      await service.receive(boss, 'po1');

      // 新均价 = (10×1200 + 5×100) / 15 = 833
      expect(prisma.sku.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'k1' },
          data: { lastCost: 100, costAvg: 833 },
        }),
      );
      expect(prisma.inventory.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { qty: { increment: 5 } } }),
      );
      expect(prisma.purchaseItem.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'i1' },
          data: { receivedQty: { increment: 5 } },
        }),
      );
      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'RECEIVED' }) }),
      );
      // 入库流水
      expect(prisma.inventoryLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ type: 'PURCHASE', change: 5, after: 15 }),
        }),
      );
    });

    it('分批到货：指定数量入库后保持 DRAFT 可继续入库', async () => {
      prisma.purchaseOrder.findUnique
        .mockResolvedValueOnce(order)
        // 尚有剩余（receivedQty 2/5）
        .mockResolvedValueOnce({ ...order, items: [{ qty: 5, receivedQty: 2 }] })
        .mockResolvedValueOnce({
          ...order,
          remark: null,
          receivedAt: null,
          createdAt: new Date(),
          supplier: { name: '晨光' },
          operator: null,
          items: [{ ...order.items[0], receivedQty: 2 }],
          payments: [],
        });
      prisma.sku.findUnique.mockResolvedValue({ id: 'k1', costAvg: 100, inventory: { qty: 0 } });
      prisma.inventory.upsert.mockResolvedValue({ qty: 2 });
      prisma.purchaseItem.update.mockResolvedValue({});
      prisma.purchaseOrder.update.mockResolvedValue({});

      await service.receive(boss, 'po1', { items: [{ itemId: 'i1', qty: 2 }] });

      // 只入 2 件
      expect(prisma.inventory.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ update: { qty: { increment: 2 } } }),
      );
      expect(prisma.purchaseItem.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { receivedQty: { increment: 2 } } }),
      );
      // 状态保持 DRAFT（update 收到空 data，不带 RECEIVED）
      const updateData = prisma.purchaseOrder.update.mock.calls[0][0].data;
      expect(updateData).toEqual({});
    });

    it('入库数量超过剩余待收时报错', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue(order);
      await expect(
        service.receive(boss, 'po1', { items: [{ itemId: 'i1', qty: 6 }] }),
      ).rejects.toThrow(/最多还可入库/);
    });

    it('非 DRAFT 状态不能重复入库', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({ ...order, status: 'RECEIVED' });
      await expect(service.receive(boss, 'po1')).rejects.toThrow(/待入库/);
    });
  });

  describe('addPayment（采购付款）', () => {
    // 全部 10 件已入库 @100 分 = 1000 分
    const baseOrder = {
      id: 'po1',
      orderNo: 'P20260101-AAAA',
      status: 'RECEIVED',
      totalAmount: 1000,
      items: [{ receivedQty: 10, unitCost: 100 }],
    };

    it('累计付款不能超过已入库金额', async () => {
      prisma.purchaseOrder.findUnique
        .mockResolvedValueOnce({ ...baseOrder, payments: [{ amount: 300 }] })
        .mockResolvedValueOnce({ ...baseOrder, payments: [{ amount: 300 }], supplier: { name: '晨光' }, operator: null, remark: null, receivedAt: null, createdAt: new Date() });
      await expect(service.addPayment(boss, 'po1', { amount: 800 })).rejects.toThrow(/超出已入库/);
    });

    it('恰好付清可以', async () => {
      prisma.purchaseOrder.findUnique
        .mockResolvedValueOnce({ ...baseOrder, payments: [{ amount: 300 }] })
        .mockResolvedValueOnce({ ...baseOrder, payments: [{ amount: 1000 }], supplier: { name: '晨光' }, operator: null, remark: null, receivedAt: null, createdAt: new Date() });
      prisma.purchasePayment.create.mockResolvedValue({});
      const result = await service.addPayment(boss, 'po1', { amount: 700 });
      expect(prisma.purchasePayment.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ amount: 700, orderId: 'po1' }) }),
      );
      expect(result.payableAmount).toBe(0);
    });

    it('部分到货时可按已入库部分付款', async () => {
      prisma.purchaseOrder.findUnique
        .mockResolvedValueOnce({
          ...baseOrder,
          status: 'DRAFT',
          items: [{ receivedQty: 4, unitCost: 100 }],
          payments: [],
        })
        .mockResolvedValueOnce({
          ...baseOrder,
          status: 'DRAFT',
          items: [{ receivedQty: 4, unitCost: 100 }],
          payments: [{ amount: 400 }],
          supplier: { name: '晨光' },
          operator: null,
          remark: null,
          receivedAt: null,
          createdAt: new Date(),
        });
      prisma.purchasePayment.create.mockResolvedValue({});
      const result = await service.addPayment(boss, 'po1', { amount: 400 });
      expect(result.payableAmount).toBe(0);
    });

    it('没有任何入库数量的采购单不能付款', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        ...baseOrder,
        status: 'DRAFT',
        items: [{ receivedQty: 0, unitCost: 100 }],
        payments: [],
      });
      await expect(service.addPayment(boss, 'po1', { amount: 100 })).rejects.toThrow(/入库数量/);
    });
  });

  describe('cancel', () => {
    it('仅 DRAFT 可取消', async () => {
      prisma.purchaseOrder.findUnique
        .mockResolvedValueOnce({ id: 'po1', orderNo: 'P', status: 'DRAFT', items: [{ receivedQty: 0 }] })
        .mockResolvedValueOnce({ id: 'po1', orderNo: 'P', status: 'CANCELLED', totalAmount: 0, remark: null, receivedAt: null, createdAt: new Date(), supplier: { name: 'x' }, operator: null, items: [], payments: [] });
      prisma.purchaseOrder.update.mockResolvedValue({});
      await service.cancel(boss, 'po1');
      expect(prisma.purchaseOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'CANCELLED' } }),
      );
    });

    it('已入库的不能取消', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({ id: 'po1', status: 'RECEIVED' });
      await expect(service.cancel(boss, 'po1')).rejects.toThrow(/待入库/);
    });

    it('分批到货后（部分入库）不能取消', async () => {
      prisma.purchaseOrder.findUnique.mockResolvedValue({
        id: 'po1',
        orderNo: 'P',
        status: 'DRAFT',
        items: [{ receivedQty: 2 }],
      });
      await expect(service.cancel(boss, 'po1')).rejects.toThrow(/已有入库数量/);
    });
  });
});
