import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { genOrderNo } from '../common/barcode.util';
import { CreatePurchaseDto, PurchasePaymentDto, ReceivePurchaseDto, SupplierUpsertDto } from './dto/purchases.dto';

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

  /** 单行已入库金额 */
  private receivedAmountOf(items: { receivedQty: number; unitCost: number }[]): number {
    return items.reduce((n, i) => n + i.receivedQty * i.unitCost, 0);
  }

  /**
   * 按供应商聚合：已入库金额与累计付款。
   * 应付口径 = 已入库金额（含 DRAFT 单的部分到货）− 累计付款；一次查询内存聚合，避免 N+1。
   */
  private async aggregateBySupplier(): Promise<
    Map<string, { receivedTotal: number; paidTotal: number; orderCount: number }>
  > {
    const [orders, payments] = await Promise.all([
      this.prisma.purchaseOrder.findMany({
        where: { status: { in: ['DRAFT', 'RECEIVED'] } },
        select: {
          supplierId: true,
          items: { select: { receivedQty: true, unitCost: true } },
        },
      }),
      this.prisma.purchasePayment.findMany({
        select: { amount: true, order: { select: { supplierId: true } } },
      }),
    ]);
    const map = new Map<string, { receivedTotal: number; paidTotal: number; orderCount: number }>();
    for (const o of orders) {
      const cur = map.get(o.supplierId) ?? { receivedTotal: 0, paidTotal: 0, orderCount: 0 };
      cur.receivedTotal += this.receivedAmountOf(o.items);
      cur.orderCount += 1;
      map.set(o.supplierId, cur);
    }
    for (const p of payments) {
      const cur = map.get(p.order.supplierId);
      if (cur) cur.paidTotal += p.amount;
    }
    return map;
  }

  // ---------- 供应商 ----------

  async listSuppliers(viewer: Viewer, keyword?: string) {
    this.requireBoss(viewer);
    const where: Prisma.SupplierWhereInput = { active: true };
    if (keyword?.trim()) where.name = { contains: keyword.trim(), mode: 'insensitive' as const };
    const [suppliers, agg] = await Promise.all([
      this.prisma.supplier.findMany({ where, orderBy: { createdAt: 'desc' } }),
      this.aggregateBySupplier(),
    ]);
    return suppliers.map((s) => {
      const a = agg.get(s.id) ?? { receivedTotal: 0, paidTotal: 0, orderCount: 0 };
      return {
        id: s.id,
        name: s.name,
        phone: s.phone,
        contact: s.contact,
        remark: s.remark,
        active: s.active,
        orderCount: a.orderCount,
        receivedTotal: a.receivedTotal,
        paidTotal: a.paidTotal,
        payable: a.receivedTotal - a.paidTotal,
      };
    });
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
          items: { select: { qty: true, receivedQty: true, unitCost: true } },
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
      items: orders.map((o) => {
        const paidAmount = o.payments.reduce((n, p) => n + p.amount, 0);
        const receivedAmount = this.receivedAmountOf(o.items);
        const receivedQty = o.items.reduce((n, i) => n + i.receivedQty, 0);
        const totalQty = o.items.reduce((n, i) => n + i.qty, 0);
        return {
          id: o.id,
          orderNo: o.orderNo,
          supplierId: o.supplierId,
          supplierName: o.supplier.name,
          status: o.status,
          totalAmount: o.totalAmount,
          receivedAmount,
          receivedQty,
          totalQty,
          paidAmount,
          payableAmount: receivedAmount - paidAmount,
          remark: o.remark,
          operatorName: o.operator?.name ?? null,
          receivedAt: o.receivedAt,
          createdAt: o.createdAt,
          itemCount: o.items.length,
        };
      }),
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
    const receivedAmount = this.receivedAmountOf(order.items);
    return {
      id: order.id,
      orderNo: order.orderNo,
      supplierId: order.supplierId,
      supplierName: order.supplier.name,
      status: order.status,
      totalAmount: order.totalAmount,
      receivedAmount,
      receivedQty: order.items.reduce((n, i) => n + i.receivedQty, 0),
      totalQty: order.items.reduce((n, i) => n + i.qty, 0),
      paidAmount,
      payableAmount: receivedAmount - paidAmount,
      remark: order.remark,
      operatorName: order.operator?.name ?? null,
      receivedAt: order.receivedAt,
      createdAt: order.createdAt,
      items: order.items,
      payments: order.payments,
    };
  }

  /**
   * 采购入库：支持分批到货。
   * dto.items 不传 = 按全部剩余待收数量入库；传则按行入库（数量 ≤ 剩余待收）。
   * 全部收齐后单据状态置为 RECEIVED，部分到货保持 DRAFT 可继续入库（也可按已入库部分付款）。
   */
  async receive(viewer: Viewer, id: string, dto?: ReceivePurchaseDto) {
    this.requireBoss(viewer);
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { items: true, supplier: { select: { name: true } } },
    });
    if (!order) throw new NotFoundException('采购单不存在');
    if (order.status !== 'DRAFT') throw new BadRequestException('仅「待入库」状态可入库');

    // 计划入库量：默认全部剩余
    const plan = new Map<string, { item: (typeof order.items)[number]; qty: number }>();
    if (dto?.items?.length) {
      const itemMap = new Map(order.items.map((i) => [i.id, i]));
      for (const r of dto.items) {
        const item = itemMap.get(r.itemId);
        if (!item) throw new BadRequestException('入库明细与采购单不符');
        const rest = item.qty - item.receivedQty;
        if (r.qty > rest) {
          throw new BadRequestException(`「${item.productName}」最多还可入库 ${rest}`);
        }
        plan.set(r.itemId, { item, qty: r.qty });
      }
    } else {
      for (const item of order.items) {
        const rest = item.qty - item.receivedQty;
        if (rest > 0) plan.set(item.id, { item, qty: rest });
      }
    }
    if (plan.size === 0) {
      throw new BadRequestException('没有待入库的数量');
    }

    let receivedNow = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const { item, qty } of plan.values()) {
        receivedNow += qty * item.unitCost;
        const sku = await tx.sku.findUnique({
          where: { id: item.skuId },
          include: { inventory: true },
        });
        if (!sku) continue; // 商品已被删除（SKU 现不支持删，防御性兜底）
        const before = sku.inventory?.qty ?? 0;
        const row = await tx.inventory.upsert({
          where: { skuId: item.skuId },
          create: { skuId: item.skuId, qty: before + qty },
          update: { qty: { increment: qty } },
        });
        await tx.inventoryLog.create({
          data: {
            skuId: item.skuId,
            type: 'PURCHASE',
            change: qty,
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
            costAvg: nextCostAvg(before, sku.costAvg, qty, item.unitCost),
          },
        });
        await tx.purchaseItem.update({
          where: { id: item.id },
          data: { receivedQty: { increment: qty } },
        });
      }
      // 全部收齐 → RECEIVED；部分到货保持 DRAFT 可继续入库
      const fresh = await tx.purchaseOrder.findUnique({
        where: { id },
        include: { items: { select: { qty: true, receivedQty: true } } },
      });
      const allReceived = (fresh?.items ?? []).every((i) => i.receivedQty >= i.qty);
      await tx.purchaseOrder.update({
        where: { id },
        data: allReceived ? { status: 'RECEIVED', receivedAt: new Date() } : {},
      });
    });

    await this.audit.log(viewer.id, 'purchase.receive', order.orderNo, {
      supplier: order.supplier.name,
      receivedAmount: receivedNow,
      lines: plan.size,
    });
    return this.getOrder(viewer, id);
  }

  async cancel(viewer: Viewer, id: string) {
    this.requireBoss(viewer);
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { items: { select: { receivedQty: true } } },
    });
    if (!order) throw new NotFoundException('采购单不存在');
    if (order.status !== 'DRAFT') throw new BadRequestException('仅「待入库」状态可取消');
    if (order.items.some((i) => i.receivedQty > 0)) {
      throw new BadRequestException('该单已有入库数量（分批到货），不能取消；可付清已入库部分后联系供应商');
    }
    await this.prisma.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log(viewer.id, 'purchase.cancel', order.orderNo, null);
    return this.getOrder(viewer, id);
  }

  /** 记录付款：按已入库金额为付款上限（支持部分到货时先付已收部分） */
  async addPayment(viewer: Viewer, id: string, dto: PurchasePaymentDto) {
    this.requireBoss(viewer);
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: { payments: true, items: { select: { receivedQty: true, unitCost: true } } },
    });
    if (!order) throw new NotFoundException('采购单不存在');
    const receivedAmount = this.receivedAmountOf(order.items);
    if (receivedAmount <= 0) {
      throw new BadRequestException('采购单还没有入库数量，入库后再付款');
    }
    const paid = order.payments.reduce((n, p) => n + p.amount, 0);
    if (paid + dto.amount > receivedAmount) {
      throw new BadRequestException(
        `付款超出已入库应付余额（已入库 ${(receivedAmount / 100).toFixed(2)} 元，未付 ${(Math.max(0, receivedAmount - paid) / 100).toFixed(2)} 元）`,
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

  /** 应付汇总：按供应商聚合（按已入库金额口径，含 DRAFT 单的部分到货） */
  async payables(viewer: Viewer) {
    this.requireBoss(viewer);
    const [suppliers, agg] = await Promise.all([
      this.prisma.supplier.findMany({ where: { active: true } }),
      this.aggregateBySupplier(),
    ]);
    const items = [];
    for (const s of suppliers) {
      const a = agg.get(s.id);
      if (!a || (a.receivedTotal === 0 && a.paidTotal === 0)) continue;
      items.push({
        supplierId: s.id,
        supplierName: s.name,
        phone: s.phone,
        receivedTotal: a.receivedTotal,
        paidTotal: a.paidTotal,
        payable: a.receivedTotal - a.paidTotal,
        orderCount: a.orderCount,
      });
    }
    return items.sort((a, b) => b.payable - a.payable);
  }
}
