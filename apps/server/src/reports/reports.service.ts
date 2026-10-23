import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.module';

type Viewer = { id: string; role: 'BOSS' | 'CASHIER' };

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  /** 销售汇总：一期简版（总额 + 支付方式分布 + 退货） */
  async summary(viewer: Viewer, from: Date, to: Date) {
    if (viewer.role !== 'BOSS') throw new ForbiddenException('仅老板可查看经营报表');
    const range = { gte: from, lte: to };
    const [orders, refunds] = await Promise.all([
      this.prisma.saleOrder.findMany({
        where: { status: 'NORMAL', createdAt: range },
        select: { payableAmount: true, payments: { select: { method: true, amount: true } } },
      }),
      this.prisma.refundOrder.findMany({
        where: { createdAt: range },
        select: { amount: true, method: true },
      }),
    ]);
    const methodMap = new Map<string, { amount: number; count: number }>();
    let salesAmount = 0;
    for (const o of orders) {
      salesAmount += o.payableAmount;
      for (const p of o.payments) {
        const cur = methodMap.get(p.method) ?? { amount: 0, count: 0 };
        cur.amount += p.amount;
        cur.count++;
        methodMap.set(p.method, cur);
      }
    }
    let refundAmount = 0;
    const refundMap = new Map<string, number>();
    for (const r of refunds) {
      refundAmount += r.amount;
      refundMap.set(r.method, (refundMap.get(r.method) ?? 0) + r.amount);
    }
    const byMethod = [...methodMap.entries()].map(([method, v]) => ({
      method,
      amount: v.amount - (refundMap.get(method) ?? 0),
      count: v.count,
    }));
    return {
      from,
      to,
      orderCount: orders.length,
      refundCount: refunds.length,
      salesAmount,
      refundAmount,
      netAmount: salesAmount - refundAmount,
      byMethod,
    };
  }

  /** 商品销量排行 */
  async topProducts(
    viewer: Viewer,
    from: Date,
    to: Date,
    limit = 20,
  ) {
    if (viewer.role !== 'BOSS') throw new ForbiddenException('仅老板可查看经营报表');
    const items = await this.prisma.saleItem.findMany({
      where: { order: { status: 'NORMAL', createdAt: { gte: from, lte: to } } },
      select: { skuId: true, productName: true, spec: true, qty: true, subtotal: true, refundedQty: true },
    });
    const map = new Map<string, { productName: string; spec: string | null; qty: number; amount: number }>();
    for (const it of items) {
      const cur = map.get(it.skuId) ?? { productName: it.productName, spec: it.spec, qty: 0, amount: 0 };
      cur.qty += it.qty - it.refundedQty;
      cur.amount += it.subtotal - it.refundedQty * (it.subtotal / Math.max(it.qty, 1));
      map.set(it.skuId, cur);
    }
    return [...map.entries()]
      .map(([skuId, v]) => ({
        skuId,
        productName: v.productName,
        spec: v.spec,
        qty: v.qty,
        amount: Math.round(v.amount),
      }))
      .filter((x) => x.qty > 0)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, limit);
  }

  /** 按日销售额序列（前端画趋势用） */
  async dailySeries(viewer: Viewer, from: Date, to: Date) {
    if (viewer.role !== 'BOSS') throw new ForbiddenException('仅老板可查看经营报表');
    const [orders, refunds] = await Promise.all([
      this.prisma.saleOrder.findMany({
        where: { status: 'NORMAL', createdAt: { gte: from, lte: to } },
        select: { payableAmount: true, createdAt: true },
      }),
      this.prisma.refundOrder.findMany({
        where: { createdAt: { gte: from, lte: to } },
        select: { amount: true, createdAt: true },
      }),
    ]);
    const dayKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const map = new Map<string, { sales: number; refunds: number; orders: number }>();
    for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
      map.set(dayKey(d), { sales: 0, refunds: 0, orders: 0 });
    }
    for (const o of orders) {
      const k = dayKey(o.createdAt);
      const cur = map.get(k) ?? { sales: 0, refunds: 0, orders: 0 };
      cur.sales += o.payableAmount;
      cur.orders += 1;
      map.set(k, cur);
    }
    for (const r of refunds) {
      const k = dayKey(r.createdAt);
      const cur = map.get(k) ?? { sales: 0, refunds: 0, orders: 0 };
      cur.refunds += r.amount;
      map.set(k, cur);
    }
    return [...map.entries()].map(([date, v]) => ({ date, ...v, net: v.sales - v.refunds }));
  }

  /** 库存资金概览（按成本估算） */
  async stockValue(viewer: Viewer) {
    if (viewer.role !== 'BOSS') throw new ForbiddenException('仅老板可查看经营报表');
    const skus = await this.prisma.sku.findMany({
      select: { costAvg: true, inventory: { select: { qty: true } } },
    });
    let totalQty = 0;
    let totalValue = 0;
    for (const s of skus) {
      const qty = s.inventory?.qty ?? 0;
      totalQty += qty;
      if (qty > 0) totalValue += qty * (s.costAvg ?? 0);
    }
    // 低库存计数：库存与安全库存的字段间比较在应用层完成
    const withSafety = await this.prisma.sku.findMany({
      where: { status: 'ON_SALE', safetyStock: { gt: 0 } },
      select: { safetyStock: true, inventory: { select: { qty: true } } },
    });
    const lowCount = withSafety.filter((s) => (s.inventory?.qty ?? 0) <= s.safetyStock).length;
    return { skuCount: skus.length, totalQty, totalValue, lowStockSkuCount: lowCount };
  }
}
