import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';

type Viewer = { id: string; role: 'BOSS' | 'CASHIER' };

@Injectable()
export class InventoryService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async list(
    viewer: Viewer,
    q: { keyword?: string; categoryId?: string; lowStock?: string; page?: string; pageSize?: string },
  ) {
    // 收银员不返回成本字段
    const isBoss = viewer.role === 'BOSS';
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 50)));
    const where: Prisma.SkuWhereInput = {};
    if (q.categoryId) where.product = { categoryId: q.categoryId };
    if (q.keyword) {
      const kw = q.keyword.trim();
      where.OR = [
        { product: { name: { contains: kw, mode: 'insensitive' as const } } },
        { barcodes: { some: { barcode: kw } } },
      ];
    }
    if (q.lowStock === 'true') {
      // 低库存过滤在结果集上执行（库存 <= 安全库存），保证排序分页语义简单可靠
    }
    const [total, skus] = await Promise.all([
      this.prisma.sku.count({ where }),
      this.prisma.sku.findMany({
        where,
        include: {
          product: { select: { name: true, unit: true, status: true, categoryId: true } },
          barcodes: { select: { barcode: true } },
          inventory: { select: { qty: true } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    let items = skus.map((s) => ({
      skuId: s.id,
      productName: s.product.name,
      spec: s.spec,
      barcode: s.barcodes[0]?.barcode ?? null,
      unit: s.product.unit,
      productStatus: s.product.status,
      status: s.status,
      retailPrice: s.retailPrice,
      qty: s.inventory?.qty ?? 0,
      safetyStock: s.safetyStock,
      low: (s.inventory?.qty ?? 0) <= s.safetyStock,
      ...(isBoss ? { lastCost: s.lastCost, costAvg: s.costAvg } : {}),
    }));
    if (q.lowStock === 'true') items = items.filter((i) => i.low);
    return { total: q.lowStock === 'true' ? items.length : total, page, pageSize, items };
  }

  async logs(
    viewer: Viewer,
    q: { skuId?: string; type?: string; from?: string; to?: string; page?: string; pageSize?: string },
  ) {
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 50)));
    const where: Prisma.InventoryLogWhereInput = {};
    if (q.skuId) where.skuId = q.skuId;
    if (q.type) where.type = q.type as Prisma.InventoryLogWhereInput['type'];
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(q.from);
      if (q.to) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(q.to);
    }
    const [total, items] = await Promise.all([
      this.prisma.inventoryLog.count({ where }),
      this.prisma.inventoryLog.findMany({
        where,
        include: {
          sku: { select: { spec: true, product: { select: { name: true } }, barcodes: true } },
          operator: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: items.map((l) => ({
        id: l.id,
        skuId: l.skuId,
        productName: l.sku.product.name,
        spec: l.sku.spec,
        barcode: l.sku.barcodes[0]?.barcode ?? null,
        type: l.type,
        change: l.change,
        after: l.after,
        refNo: l.refNo,
        note: l.note,
        operatorName: l.operator?.name ?? null,
        createdAt: l.createdAt,
      })),
    };
  }

  /** 库存调整（盘点差异/报损）：仅老板 */
  async adjust(
    viewer: Viewer,
    input: { skuId: string; actualQty: number; note?: string },
  ) {
    if (viewer.role !== 'BOSS') throw new ForbiddenException('仅老板可调整库存');
    if (input.actualQty < 0) throw new BadRequestException('库存不能为负数');
    const sku = await this.prisma.sku.findUnique({
      where: { id: input.skuId },
      include: { product: { select: { name: true } }, inventory: true },
    });
    if (!sku) throw new BadRequestException('SKU 不存在');
    const before = sku.inventory?.qty ?? 0;
    const change = input.actualQty - before;
    if (change === 0) return { ok: true, change: 0 };
    await this.prisma.$transaction(async (tx) => {
      await tx.inventory.upsert({
        where: { skuId: input.skuId },
        create: { skuId: input.skuId, qty: input.actualQty },
        update: { qty: input.actualQty },
      });
      await tx.inventoryLog.create({
        data: {
          skuId: input.skuId,
          type: 'ADJUST',
          change,
          after: input.actualQty,
          note: input.note ?? `调整（${before} → ${input.actualQty}）`,
          operatorId: viewer.id,
        },
      });
    });
    await this.audit.log(viewer.id, 'inventory.adjust', input.skuId, {
      productName: sku.product.name,
      before,
      after: input.actualQty,
      note: input.note,
    });
    return { ok: true, change };
  }
}
