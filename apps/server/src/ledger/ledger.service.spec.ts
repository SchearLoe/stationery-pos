import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { LedgerService } from './ledger.service';

function makePrismaMock() {
  const prisma: any = {};
  prisma.$transaction = jest.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));
  prisma.expense = {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
    groupBy: jest.fn(),
  };
  prisma.saleOrder = { aggregate: jest.fn() };
  prisma.refundOrder = { aggregate: jest.fn() };
  prisma.saleItem = { findMany: jest.fn() };
  prisma.purchaseOrder = { aggregate: jest.fn() };
  prisma.purchasePayment = { aggregate: jest.fn() };
  prisma.memberTxn = { aggregate: jest.fn() };
  prisma.auditLog = { create: jest.fn() };
  return prisma;
}

const boss = { id: 'boss-1', role: 'BOSS' as const };
const cashier = { id: 'c-1', role: 'CASHIER' as const };
const audit = { log: jest.fn().mockResolvedValue(undefined) };

describe('LedgerService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: LedgerService;

  beforeEach(() => {
    prisma = makePrismaMock();
    audit.log.mockClear();
    service = new LedgerService(prisma, audit as never);
  });

  it('收银员不能记账', async () => {
    await expect(
      service.createExpense(cashier, { date: new Date().toISOString(), category: 'RENT', amount: 100, title: 'x' }),
    ).rejects.toThrow(ForbiddenException);
    await expect(service.monthlyStatement(cashier, '2026-10')).rejects.toThrow(ForbiddenException);
  });

  describe('createExpense', () => {
    it('补货采购不能在杂项支出登记（应走采购付款）', async () => {
      await expect(
        service.createExpense(boss, {
          date: '2026-10-01T00:00:00Z',
          category: 'RESTOCK',
          amount: 100,
          title: '进货',
        }),
      ).rejects.toThrow(/采购管理/);
    });

    it('金额必须大于 0', async () => {
      await expect(
        service.createExpense(boss, {
          date: '2026-10-01T00:00:00Z',
          category: 'RENT',
          amount: 0,
          title: '房租',
        }),
      ).rejects.toThrow(/大于 0/);
    });

    it('正常创建并写审计', async () => {
      prisma.expense.create.mockResolvedValue({ id: 'e1', amount: 300000 });
      const e = await service.createExpense(boss, {
        date: '2026-10-01T00:00:00Z',
        category: 'RENT',
        amount: 300000,
        title: '十月房租',
      });
      expect(e.id).toBe('e1');
      expect(audit.log).toHaveBeenCalledWith('boss-1', 'expense.create', 'e1', expect.anything());
    });
  });

  describe('monthlyStatement 月结口径', () => {
    beforeEach(() => {
      prisma.saleOrder.aggregate.mockResolvedValue({ _sum: { payableAmount: 100000 }, _count: 3 });
      prisma.refundOrder.aggregate.mockResolvedValue({ _sum: { amount: 20000 }, _count: 1 });
      // 成本快照：卖出 2 退 1 成本 1500；卖出 1 未退无成本
      prisma.saleItem.findMany.mockResolvedValue([
        { qty: 2, refundedQty: 1, costSnapshot: 1500 },
        { qty: 1, refundedQty: 0, costSnapshot: null },
      ]);
      prisma.purchaseOrder.aggregate.mockResolvedValue({ _sum: { totalAmount: 30000 } });
      prisma.purchasePayment.aggregate.mockResolvedValue({ _sum: { amount: 10000 } });
      prisma.expense.groupBy.mockResolvedValue([
        { category: 'RENT', _sum: { amount: 5000 } },
        { category: 'OTHER', _sum: { amount: 1000 } },
      ]);
      prisma.memberTxn.aggregate.mockResolvedValue({ _sum: { amount: 20000 } });
    });

    it('净销售/毛利/净利估算按口径计算', async () => {
      const s = await service.monthlyStatement(boss, '2026-10');
      expect(s.salesAmount).toBe(100000);
      expect(s.refundAmount).toBe(20000);
      expect(s.netSalesAmount).toBe(80000);
      // 销售成本 = (2-1)×1500 + 1×0 = 1500
      expect(s.cogsAmount).toBe(1500);
      // 毛利 = 80000 - 1500
      expect(s.grossProfit).toBe(78500);
      expect(s.purchaseReceivedAmount).toBe(30000);
      expect(s.purchasePaidAmount).toBe(10000);
      expect(s.expenseTotal).toBe(6000);
      expect(s.memberRechargeAmount).toBe(20000);
      // 净利估算 = 毛利 - 杂项支出
      expect(s.netProfitEstimate).toBe(72500);
    });

    it('月份格式非法时报错', async () => {
      await expect(service.monthlyStatement(boss, '2026/10')).rejects.toThrow(/YYYY-MM/);
    });
  });
});
