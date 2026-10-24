import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.module';
import { AuditService } from '../common/audit.service';
import { genOrderNo } from '../common/barcode.util';
import { CreatePurchaseDto, PurchasePaymentDto, SupplierUpsertDto } from './dto/purchases.dto';

type Viewer = { id: string; role: 'BOSS' | 'CASHIER' };

/** 移动加权平均成本：新均价 = (原数量×原均价 + 入库数量×进价) / 合计数量 */
function nextCostAvg(oldQty: number, oldAvg: number | null, inQty: number, inCost: number): number {
  const baseQty = Math.max(0, oldQty);
  const baseAvg = oldAvg ?? 0;
  return Math.round((baseQty * baseAvg + inQty * inCost) / (baseQty + inQty));
}

@Injectable()
export class PurchasesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private requireBoss(viewer: Viewer) {
    if (viewer.role !== 'BOSS') throw new ForbiddenException('仅老板可管理采购');
  }

  // ---------- 供应商 ----------

  async listSuppliers(viewer: Viewer, keyword?: string) {
    this.requireBoss(viewer);
    const where: Prisma.SupplierWhereInput = { active: true };
    if (keyword?.trim()) where.name = { contains: keyword.trim(), mode: 'insensitive' as const };
    const suppliers = await this.prisma.supplier.findMany({
      where,
      include: { purchaseOrders: { where: { status: 'RECEIVED' }, select: { totalAmount: true } } },
      orderBy: { createdAt: 'desc' },
    });
    // 应付 = 已入库采购总额 - 全部付款（含未入库单的预付，简化口径：按供应商汇总）
    const items = [];
    for (const s of suppliers) {
      const receivedTotal = s.purchaseOrders.reduce((n, o) => n + o.totalAmount, 0);
      const paidTotal = await this.prisma.purchasePayment.aggregate({
        where: { order: { supplierId: s.id } },
        _sum: { amount: true },
      });
      items.push({
        id: s.id,
        name: s.name,
        phone: s.phone,
        contact: s.contact,
        remark: s.remark,
        active: s.active,
        orderCount: s.purchaseOrders.length,
        receivedTotal,
        paidTotal: paidTotal._sum.amount ?? 0,
        payable: receivedTotal - (paidTotal._sum.amount ?? 0),
      });
    }
    return items;
  }

  async createSupplier(viewer: Viewer, dto: SupplierUpsertDto) {
    this.requireBoss(viewer);
    const supplier = await this.prisma.supplier.create({ data: { ...dto } });
    await this.audit.log(viewer.id, 'supplier.create', supplier.id, { name: dto.name });
    return supplier;
  }

  async updateSupplier(viewer: Viewer, id: string, dto: SupplierUpsertDto) {
    this.requireBoss(viewer);
    const supplier = await this.prisma.supplier.update({ where: { id }, data: { ...dto } }).catch(() => {
      throw new NotFoundException('供应商不存在');
    });
    await this.audit.log(viewer.id, 'supplier.update', id, { name: dto.name });
    return supplier;
  }

  async deleteSupplier(viewer: Viewer, id: string) {
    this.requireBoss(viewer);
    const count = await this.prisma.purchaseOrder.count({ where: { supplierId: id } });
    if (count > 0) {
      // 已有采购往来的供应商只停用，保留账目可追溯
      await this.prisma.supplier.update({ where: { id }, data: { active: false } });
      await this.audit.log(viewer.id, 'supplier.disable', id, { orderCount: count });
      return { ok: true, disabled: true };
    }
    await this.prisma.supplier.delete({ where: { id } });
    await this.audit.log(viewer.id, 'supplier.delete', id, null);
    return { ok: true, disabled: false };
  }

  // ---------- 采购单 ----------

  async createOrder(viewer: Viewer, dto: CreatePurchaseDto) {
    this.requireBoss(viewer);
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: dto.supplierId, active: true },
    });
    if (!supplier) throw new BadRequestException('供应商不存在或已停用');

    const skuIds = [...new Set(dto.items.map((i) => i.skuId))];
    const skus = await this.prisma.sku.findMany({
      where: { id: { in: skuIds } },
      include: {
        product: { select: { name: true, unit: true } },
        barcodes: { select: { barcode: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    const skuMap = new Map(skus.map((s) => [s.id, s]));
    const lines = dto.items.map((i) => {
      const sku = skuMap.get(i.skuId);
      if (!sku) throw new BadRequestException('商品不存在或已被删除');
      return { sku, qty: i.qty, unitCost: i.unitCost, subtotal: i.qty * i.unitCost };
    });
    const totalAmount = lines.reduce((n, l) => n + l.subtotal, 0);

    const order = await this.prisma.$transaction(async (tx) => {
      let created: Prisma.PurchaseOrderGetPayload<{ include: { items: true } }> | null = null;
      for (let attempt = 0; attempt < 3 && !created; attempt++) {
        try {
          created = await tx.purchaseOrder.create({
            data: {
              orderNo: genOrderNo('P'),
              supplierId: dto.supplierId,
              status: 'DRAFT',
              totalAmount,
              remark: dto.remark ?? null,
              operatorId: viewer.id,
              items: {
                create: lines.map((l) => ({
                  skuId: l.sku.id,
                  productName: l.sku.product.name,
                  spec: l.sku.spec,
                  barcode: l.sku.barcodes[0]?.barcode ?? null,
                  unit: l.sku.product.unit,
                  qty: l.qty,
                  unitCost: l.unitCost,
                  subtotal: l.subtotal,
                })),
              },
            },
            include: { items: true },
          });
        } catch (e) {
          const isUniqueConflict =
            e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
          if (!isUniqueConflict || attempt === 2) throw e;
        }
      }
      if (!created) throw new BadRequestException('采购单号生成失败，请重试');
      return created;
    });

    await this.audit.log(viewer.id, 'purchase.create', order.orderNo, {
      supplier: supplier.name,
      totalAmount,
      items: lines.length,
    });
    return this.getOrder(viewer, order.id);
  }

  async listOrders(
    viewer: Viewer,
    q: { status?: string; supplierId?: string; keyword?: string; page?: string; pageSize?: string },
  ) {
    this.requireBoss(viewer);
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20)));
    const where: Prisma.PurchaseOrderWhereInput = {};
    if (q.status) where.status = q.status as Prisma.PurchaseOrderWhereInput['status'];
    if (q.supplierId) where.supplierId = q.supplierId;
    if (q.keyword?.trim()) where.orderNo = { startsWith: q.keyword.trim() };
    const [total, orders] = await Promise.all([
      this.prisma.purchaseOrder.count({ where }),
      this.prisma.purchaseOrder.findMany({
        where,
        include: {
          supplier: { select: { name: true } },
          operator: { select: { name: true } },
          items: { select: { id: true } },
          payments: { select: { amount: true } },
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
      items: orders.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        supplierId: o.supplierId,
        supplierName: o.supplier.name,
        status: o.status,
        totalAmount: o.totalAmount,
        paidAmount: o.payments.reduce((n, p) => n + p.amount, 0),
        payableAmount: o.totalAmount - o.payments.reduce((n, p) => n + p.amount, 0),
        remark: o.remark,
        operatorName: o.operator?.name ?? null,
        receivedAt: o.receivedAt,
        createdAt: o.createdAt,
        itemCount: o.items.length,
      })),
    };
  }

  async getOrder(viewer: Viewer, id: string) {
    this.requireBoss(viewer);
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        supplier: { select: { name: true } },
        operator: { select: { name: true } },
        items: true,
        payments: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw new NotFoundException('采购单不存在');
    const paidAmount = order.payments.reduce((n, p) => n + p.amount, 0);
    return {
      id: order.id,
      orderNo: order.orderNo,
      supplierId: order.supplierId,
      supplierName: order.supplier.name,
      status: order.status,
      totalAmount: order.totalAmount,
      paidAmount,
      payableAmount: order.totalAmount - paidAmount,
      remark: order.remark,
      operatorName: order.operator?.name ?? null,
      receivedAt: order.receivedAt,
      createdAt: order.createdAt,
      items: order.items,
      payments: order.payments,
    };
  }

  /** 采购入库：库存增加 + 采购流水 + 更新最近进价与移动加权平均成本 */
  async receive(viewer: Viewer, id: string) {
    this.requireBoss(viewer);
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { items: true, supplier: { select: { name: true } } },
    });
    if (!order) throw new NotFoundException('采购单不存在');
    if (order.status !== 'DRAFT') throw new BadRequestException('仅「待入库」状态可入库');

    await this.prisma.$transaction(async (tx) => {
      for (const item of order.items) {
        const sku = await tx.sku.findUnique({
          where: { id: item.skuId },
          include: { inventory: true },
        });
        if (!sku) continue; // 商品已被删除（SKU 现不支持删，防御性兜底）
        const before = sku.inventory?.qty ?? 0;
        const row = await tx.inventory.upsert({
          where: { skuId: item.skuId },
          create: { skuId: item.skuId, qty: before + item.qty },
          update: { qty: { increment: item.qty } },
        });
        await tx.inventoryLog.create({
          data: {
            skuId: item.skuId,
            type: 'PURCHASE',
            change: item.qty,
            after: row.qty,
            refNo: order.orderNo,
            note: `采购入库 @${(item.unitCost / 100).toFixed(2)}元`,
            operatorId: viewer.id,
          },
        });
        await tx.sku.update({
          where: { id: item.skuId },
          data: {
            lastCost: item.unitCost,
            costAvg: nextCostAvg(before, sku.costAvg, item.qty, item.unitCost),
          },
        });
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'RECEIVED', receivedAt: new Date() },
      });
    });

    await this.audit.log(viewer.id, 'purchase.receive', order.orderNo, {
      supplier: order.supplier.name,
      totalAmount: order.totalAmount,
      items: order.items.length,
    });
    return this.getOrder(viewer, id);
  }

  async cancel(viewer: Viewer, id: string) {
    this.requireBoss(viewer);
    const order = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('采购单不存在');
    if (order.status !== 'DRAFT') throw new BadRequestException('仅「待入库」状态可取消');
    await this.prisma.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log(viewer.id, 'purchase.cancel', order.orderNo, null);
    return this.getOrder(viewer, id);
  }

  /** 记录付款：只能付已入库单，累计付款不超采购总额 */
  async addPayment(viewer: Viewer, id: string, dto: PurchasePaymentDto) {
    this.requireBoss(viewer);
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { payments: true },
    });
    if (!order) throw new NotFoundException('采购单不存在');
    if (order.status !== 'RECEIVED') throw new BadRequestException('仅「已入库」的采购单可付款');
    const paid = order.payments.reduce((n, p) => n + p.amount, 0);
    if (paid + dto.amount > order.totalAmount) {
      throw new BadRequestException(
        `付款超出应付余额（应付 ${(order.totalAmount - paid) / 100} 元）`,
      );
    }
    await this.prisma.purchasePayment.create({
      data: {
        orderId: id,
        amount: dto.amount,
        method: dto.method ?? 'CASH',
        note: dto.note ?? null,
        operatorId: viewer.id,
      },
    });
    await this.audit.log(viewer.id, 'purchase.pay', order.orderNo, { amount: dto.amount });
    return this.getOrder(viewer, id);
  }

  /** 应付汇总：按供应商聚合（已入库未付清部分） */
  async payables(viewer: Viewer) {
    this.requireBoss(viewer);
    const suppliers = await this.prisma.supplier.findMany({ where: { active: true } });
    const items = [];
    for (const s of suppliers) {
      const agg = await this.prisma.purchaseOrder.aggregate({
        where: { supplierId: s.id, status: 'RECEIVED' },
        _sum: { totalAmount: true },
        _count: true,
      });
      const paid = await this.prisma.purchasePayment.aggregate({
        where: { order: { supplierId: s.id } },
        _sum: { amount: true },
      });
      const receivedTotal = agg._sum.totalAmount ?? 0;
      const paidTotal = paid._sum.amount ?? 0;
      if (receivedTotal === 0 && paidTotal === 0) continue;
      items.push({
        supplierId: s.id,
        supplierName: s.name,
        phone: s.phone,
        receivedTotal,
        paidTotal,
        payable: receivedTotal - paidTotal,
        orderCount: agg._count,
      });
    }
    return items.sort((a, b) => b.payable - a.payable);
  }
}
