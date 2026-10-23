import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.module';
import { AuditService } from '../common/audit.service';

type Viewer = { id: string; role: 'BOSS' | 'CASHIER' };

export interface ShiftSummary {
  method: 'CASH' | 'WECHAT' | 'ALIPAY' | 'CARD' | 'OTHER';
  amount: number;
  count: number;
}

@Injectable()
export class ShiftsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /** 班次实时汇总：销售与退货合并后的各支付方式净额 */
  private async summarize(
    tx: Prisma.TransactionClient | PrismaService,
    shiftId: string,
  ): Promise<{ total: number; orderCount: number; refundAmount: number; summary: ShiftSummary[] }> {
    const [orders, refunds] = await Promise.all([
      tx.saleOrder.findMany({
        where: { shiftId, status: 'NORMAL' },
        select: { payableAmount: true, payments: { select: { method: true, amount: true } } },
      }),
      tx.refundOrder.findMany({
        where: { shiftId },
        select: { amount: true, method: true },
      }),
    ]);
    const map = new Map<ShiftSummary['method'], { amount: number; count: number }>();
    let total = 0;
    for (const o of orders) {
      total += o.payableAmount;
      for (const p of o.payments) {
        const cur = map.get(p.method) ?? { amount: 0, count: 0 };
        cur.amount += p.amount;
        cur.count += 1;
        map.set(p.method, cur);
      }
    }
    let refundAmount = 0;
    for (const r of refunds) {
      refundAmount += r.amount;
      const cur = map.get(r.method) ?? { amount: 0, count: 0 };
      cur.amount -= r.amount;
      map.set(r.method, cur);
    }
    const summary = [...map.entries()].map(([method, v]) => ({ method, ...v }));
    return { total, orderCount: orders.length, refundAmount, summary };
  }

  async current(viewer: Viewer) {
    const shift = await this.prisma.shift.findFirst({
      where: { cashierId: viewer.id, status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
    });
    if (!shift) return null;
    const s = await this.summarize(this.prisma, shift.id);
    return { ...shift, ...s };
  }

  async open(viewer: Viewer) {
    const exist = await this.prisma.shift.findFirst({
      where: { cashierId: viewer.id, status: 'OPEN' },
    });
    if (exist) throw new BadRequestException('已有进行中的班次');
    const shift = await this.prisma.shift.create({ data: { cashierId: viewer.id } });
    await this.audit.log(viewer.id, 'shift.open', shift.id);
    return this.current(viewer);
  }

  async close(
    viewer: Viewer,
    input: { countedCash: number; note?: string },
  ) {
    const shift = await this.prisma.shift.findFirst({
      where: { cashierId: viewer.id, status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
    });
    if (!shift) throw new NotFoundException('没有进行中的班次');
    const s = await this.summarize(this.prisma, shift.id);
    const expectedCash = s.summary.find((x) => x.method === 'CASH')?.amount ?? 0;
    const updated = await this.prisma.shift.update({
      where: { id: shift.id },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        expectedCash,
        countedCash: input.countedCash,
        diff: input.countedCash - expectedCash,
        note: input.note ?? null,
      },
    });
    await this.audit.log(viewer.id, 'shift.close', shift.id, {
      expectedCash,
      countedCash: input.countedCash,
      diff: updated.diff,
    });
    return { ...updated, ...s };
  }

  list(viewer: Viewer, q: { page?: string; pageSize?: string; mine?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20)));
    const where: Prisma.ShiftWhereInput = {};
    // 收银员只能看自己的班次；老板看全部
    if (viewer.role !== 'BOSS' || q.mine === 'true') where.cashierId = viewer.id;
    return this.prisma.$transaction(async (tx) => {
      const [total, items] = await Promise.all([
        tx.shift.count({ where }),
        tx.shift.findMany({
          where,
          include: { cashier: { select: { name: true } } },
          orderBy: { openedAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { total, page, pageSize, items };
    });
  }
}
