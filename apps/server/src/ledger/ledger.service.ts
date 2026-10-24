import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ExpenseCategory, Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.module';
import { AuditService } from '../common/audit.service';

type Viewer = { id: string; role: 'BOSS' | 'CASHIER' };

@Injectable()
export class LedgerService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private requireBoss(viewer: Viewer) {
    if (viewer.role !== 'BOSS') throw new ForbiddenException('仅老板可管理账目');
  }

  // ---------- 支出记账 ----------

  async createExpense(
    viewer: Viewer,
    dto: { date: string; category: string; amount: number; title: string; note?: string | null },
  ) {
    this.requireBoss(viewer);
    if (dto.amount <= 0) throw new BadRequestException('支出金额必须大于 0');
    if (dto.category === 'RESTOCK') {
      throw new BadRequestException('补货采购请走「采购管理」登记付款，此处记录日常杂项支出');
    }
    const expense = await this.prisma.expense.create({
      data: {
        date: new Date(dto.date),
        category: dto.category as ExpenseCategory,
        amount: dto.amount,
        title: dto.title,
        note: dto.note ?? null,
        operatorId: viewer.id,
      },
    });
    await this.audit.log(viewer.id, 'expense.create', expense.id, {
      title: dto.title,
      amount: dto.amount,
      category: dto.category,
    });
    return expense;
  }

  async updateExpense(
    viewer: Viewer,
    id: string,
    dto: { date?: string; category?: string; amount?: number; title?: string; note?: string | null },
  ) {
    this.requireBoss(viewer);
    const data: Prisma.ExpenseUpdateInput = {};
    if (dto.date) data.date = new Date(dto.date);
    if (dto.category) data.category = dto.category as ExpenseCategory;
    if (dto.amount !== undefined) {
      if (dto.amount <= 0) throw new BadRequestException('支出金额必须大于 0');
      data.amount = dto.amount;
    }
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.note !== undefined) data.note = dto.note;
    const expense = await this.prisma.expense.update({ where: { id }, data }).catch(() => {
      throw new NotFoundException('支出记录不存在');
    });
    await this.audit.log(viewer.id, 'expense.update', id, null);
    return expense;
  }

  async deleteExpense(viewer: Viewer, id: string) {
    this.requireBoss(viewer);
    const expense = await this.prisma.expense.delete({ where: { id } }).catch(() => {
      throw new NotFoundException('支出记录不存在');
    });
    await this.audit.log(viewer.id, 'expense.delete', id, {
      title: expense.title,
      amount: expense.amount,
    });
    return { ok: true };
  }

  async listExpenses(
    viewer: Viewer,
    q: { month?: string; from?: string; to?: string; category?: string; page?: string; pageSize?: string },
  ) {
    this.requireBoss(viewer);
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 50)));
    const where: Prisma.ExpenseWhereInput = {};
    if (q.month && /^\d{4}-\d{2}$/.test(q.month)) {
      const start = new Date(`${q.month}-01T00:00:00`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);
      where.date = { gte: start, lt: end };
    } else if (q.from || q.to) {
      where.date = {};
      if (q.from) (where.date as Prisma.DateTimeFilter).gte = new Date(q.from);
      if (q.to) (where.date as Prisma.DateTimeFilter).lte = new Date(q.to);
    }
    if (q.category) where.category = q.category as Prisma.EnumExpenseCategoryFilter['equals'];
    const [total, items, sum] = await Promise.all([
      this.prisma.expense.count({ where }),
      this.prisma.expense.findMany({
        where,
        include: { operator: { select: { name: true } } },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.expense.aggregate({ where, _sum: { amount: true } }),
    ]);
    return {
      total,
      page,
      pageSize,
      totalAmount: sum._sum.amount ?? 0,
      items: items.map((e) => ({ ...e, operatorName: e.operator?.name ?? null })),
    };
  }

  // ---------- 月结报表 ----------

  /** 月度经营报表：销售/退货/成本/毛利 + 采购/付款 + 杂项支出 + 会员充值（口径见各字段注释） */
  async monthlyStatement(viewer: Viewer, month: string) {
    this.requireBoss(viewer);
    if (!/^\d{4}-\d{2}$/.test(month)) throw new BadRequestException('月份格式应为 YYYY-MM');
    const start = new Date(`${month}-01T00:00:00`);
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    const saleRange = { gte: start, lt: end };

    const [orders, refunds, cogsItems, purchaseReceived, purchasePaid, expenses, rechargeAgg] =
      await Promise.all([
        this.prisma.saleOrder.aggregate({
          where: { status: 'NORMAL', createdAt: saleRange },
          _sum: { payableAmount: true },
          _count: true,
        }),
        this.prisma.refundOrder.aggregate({
          where: { createdAt: saleRange },
          _sum: { amount: true },
          _count: true,
        }),
        this.prisma.saleItem.findMany({
          where: { order: { status: 'NORMAL', createdAt: saleRange } },
          select: { qty: true, refundedQty: true, costSnapshot: true },
        }),
        this.prisma.purchaseOrder.aggregate({
          where: { status: 'RECEIVED', receivedAt: saleRange },
          _sum: { totalAmount: true },
        }),
        this.prisma.purchasePayment.aggregate({
          where: { createdAt: saleRange },
          _sum: { amount: true },
        }),
        this.prisma.expense.groupBy({
          by: ['category'],
          where: { date: saleRange },
          _sum: { amount: true },
        }),
        this.prisma.memberTxn.aggregate({
          where: { type: 'RECHARGE', createdAt: saleRange },
          _sum: { amount: true },
        }),
      ]);

    const salesAmount = orders._sum.payableAmount ?? 0;
    const refundAmount = refunds._sum.amount ?? 0;
    const netSalesAmount = salesAmount - refundAmount;
    // 销售成本按下单时点的成本快照估算（含被退货部分按净销量计），未维护成本的商品按 0 计
    const cogsAmount = cogsItems.reduce(
      (n, i) => n + (i.qty - i.refundedQty) * (i.costSnapshot ?? 0),
      0,
    );
    const expenseTotal = expenses.reduce((n, e) => n + (e._sum.amount ?? 0), 0);
    return {
      month,
      salesAmount,
      refundAmount,
      netSalesAmount,
      orderCount: orders._count,
      refundCount: refunds._count,
      cogsAmount,
      grossProfit: netSalesAmount - cogsAmount,
      purchaseReceivedAmount: purchaseReceived._sum.totalAmount ?? 0,
      purchasePaidAmount: purchasePaid._sum.amount ?? 0,
      expenseTotal,
      expensesByCategory: expenses.map((e) => ({
        category: e.category,
        amount: e._sum.amount ?? 0,
      })),
      memberRechargeAmount: rechargeAgg._sum.amount ?? 0,
      netProfitEstimate: netSalesAmount - cogsAmount - expenseTotal,
    };
  }
}
