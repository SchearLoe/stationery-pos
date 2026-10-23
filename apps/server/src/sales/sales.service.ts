import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.module';
import { AuditService } from '../common/audit.service';
import { SettingService } from '../common/setting.service';
import { genOrderNo } from '../common/barcode.util';
import { CreateRefundDto, CreateSaleOrderDto, ListOrdersQuery } from './dto/sales.dto';

type Viewer = { id: string; role: 'BOSS' | 'CASHIER' };

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private settings: SettingService,
  ) {}

  /** 当前操作员必须处于开启中的班次 */
  private async requireOpenShift(tx: Prisma.TransactionClient, cashierId: string) {
    const shift = await tx.shift.findFirst({
      where: { cashierId, status: 'OPEN' },
      orderBy: { openedAt: 'desc' },
    });
    if (!shift) throw new BadRequestException('请先开始班次后再操作');
    return shift;
  }

  /** 创建销售单：事务内完成计价校验、扣库存、写库存流水 */
  async createSale(dto: CreateSaleOrderDto, viewer: Viewer) {
    // 离线单：断网期间在收银端本地生成，联网后经 outbox 队列补传。
    // 金额按「离线时点」的客户端数据入账（缓存价），不做在线时点的改价/停售强校验。
    const isOffline = Boolean(dto.clientId && dto.offlineCreatedAt);
    // 幂等：同一 clientId 只生成一单
    if (dto.clientId) {
      const exist = await this.prisma.saleOrder.findUnique({ where: { clientId: dto.clientId } });
      if (exist) return this.getOrder(exist.id, viewer);
    }
    if (isOffline && !dto.clientOrderNo) {
      throw new BadRequestException('离线单缺少客户端单号');
    }

    const settings = await this.settings.get();
    const discount = dto.discountAmount ?? 0;

    // 服务端重新计价，不信任客户端金额
    const skuIds = [...new Set(dto.items.map((i) => i.skuId))];
    const skus = await this.prisma.sku.findMany({
      where: { id: { in: skuIds } },
      include: {
        product: { select: { name: true, unit: true, status: true } },
        inventory: true,
        barcodes: { select: { barcode: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    const skuMap = new Map(skus.map((s) => [s.id, s]));

    let total = 0;
    const lines = dto.items.map((i) => {
      const sku = skuMap.get(i.skuId);
      if (!sku) throw new BadRequestException('商品不存在或已被删除');
      if (!isOffline && (sku.status !== 'ON_SALE' || sku.product.status !== 'ON_SALE')) {
        throw new BadRequestException(`商品「${sku.product.name}」已停售`);
      }
      // 收银员改价下限保护（在线单；离线单以下单时点的校验为准）
      if (
        !isOffline &&
        viewer.role === 'CASHIER' &&
        sku.minPrice !== null &&
        i.unitPrice < sku.minPrice
      ) {
        throw new BadRequestException(
          `「${sku.product.name}」改价低于最低售价，请老板授权`,
        );
      }
      const subtotal = i.qty * i.unitPrice;
      total += subtotal;
      return { sku, qty: i.qty, unitPrice: i.unitPrice, subtotal };
    });

    if (discount < 0 || discount > total) {
      throw new BadRequestException('整单折扣金额不合法');
    }
    // 收银员整单折扣下限（在线单）
    if (!isOffline && viewer.role === 'CASHIER' && discount > 0) {
      const minPercent = settings.cashierMinDiscountPercent;
      const payPercent = Math.floor(((total - discount) / total) * 100);
      if (payPercent < minPercent) {
        throw new BadRequestException(`整单折扣低于下限 ${minPercent}%，请老板授权`);
      }
    }
    const payable = total - discount;
    const paid = dto.payments.reduce((s, p) => s + p.amount, 0);
    if (paid !== payable) {
      throw new BadRequestException(`支付金额（${paid}）与应付金额（${payable}）不一致`);
    }

    // 库存预检（是否允许负库存）
    if (!settings.allowNegativeStock) {
      const soldBySku = new Map<string, number>();
      for (const l of lines) soldBySku.set(l.sku.id, (soldBySku.get(l.sku.id) ?? 0) + l.qty);
      for (const [skuId, sold] of soldBySku) {
        const cur = skuMap.get(skuId)!.inventory?.qty ?? 0;
        if (cur < sold) {
          const sku = skuMap.get(skuId)!;
          throw new BadRequestException(`「${sku.product.name}」库存不足（剩 ${cur}）`);
        }
      }
    }

    const order = await this.prisma.$transaction(async (tx) => {
      // 离线单不强制班次（断网期间可能无法开班），能挂上当前开启班次则挂
      const shift = isOffline
        ? await tx.shift.findFirst({
            where: { cashierId: viewer.id, status: 'OPEN' },
            orderBy: { openedAt: 'desc' },
          })
        : await this.requireOpenShift(tx, viewer.id);

      let created: Prisma.SaleOrderGetPayload<{ include: { items: true; payments: true } }> | null =
        null;
      // 单号冲突重试（离线单号固定，冲突即业务错误）
      for (let attempt = 0; attempt < 3 && !created; attempt++) {
        try {
          created = await tx.saleOrder.create({
            data: {
              orderNo: isOffline ? dto.clientOrderNo! : genOrderNo('S'),
              clientId: dto.clientId,
              shiftId: shift?.id ?? null,
              cashierId: viewer.id,
              status: 'NORMAL',
              totalAmount: total,
              discountAmount: discount,
              payableAmount: payable,
              remark: dto.remark ?? null,
              offlineCreatedAt: dto.offlineCreatedAt ? new Date(dto.offlineCreatedAt) : null,
              items: {
                create: lines.map((l) => ({
                  skuId: l.sku.id,
                  productName: l.sku.product.name,
                  spec: l.sku.spec,
                  barcode: l.sku.barcodes[0]?.barcode ?? null,
                  unit: l.sku.product.unit,
                  qty: l.qty,
                  unitPrice: l.unitPrice,
                  subtotal: l.subtotal,
                  costSnapshot: l.sku.costAvg ?? l.sku.lastCost ?? null,
                })),
              },
              payments: { create: dto.payments },
            },
            include: { items: true, payments: true },
          });
        } catch (e) {
          const isUniqueConflict =
            e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
          if (isOffline && isUniqueConflict) {
            throw new BadRequestException(
              '离线单号与服务端已有单据冲突（该单可能已被同步过），请检查同步状态',
            );
          }
          if (!isUniqueConflict || attempt === 2) throw e;
        }
      }
      if (!created) throw new BadRequestException('单号生成失败，请重试');

      // 扣库存 + 流水（按 SKU 聚合后扣减）
      const soldBySku = new Map<string, number>();
      for (const l of lines) soldBySku.set(l.sku.id, (soldBySku.get(l.sku.id) ?? 0) + l.qty);
      for (const [skuId, sold] of soldBySku) {
        const row = await tx.inventory.upsert({
          where: { skuId },
          create: { skuId, qty: -sold },
          update: { qty: { decrement: sold } },
        });
        await tx.inventoryLog.create({
          data: {
            skuId,
            type: 'SALE',
            change: -sold,
            after: row.qty,
            refNo: created.orderNo,
            operatorId: viewer.id,
          },
        });
      }
      return created;
    });

    await this.audit.log(viewer.id, 'sale.create', order.orderNo, {
      payable,
      items: lines.length,
    });
    return this.getOrder(order.id, viewer);
  }

  async listOrders(viewer: Viewer, q: ListOrdersQuery) {
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20)));
    const where: Prisma.SaleOrderWhereInput = {};
    // 收银员只能看自己的单据
    where.cashierId = viewer.role === 'BOSS' ? q.cashierId : viewer.id;
    if (q.keyword) where.orderNo = { startsWith: q.keyword.trim() };
    if (q.status) where.status = q.status;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(q.from);
      if (q.to) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(q.to);
    }
    const [total, orders] = await Promise.all([
      this.prisma.saleOrder.count({ where }),
      this.prisma.saleOrder.findMany({
        where,
        include: {
          cashier: { select: { name: true } },
          items: true,
          payments: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items: orders };
  }

  async getOrder(id: string, viewer: Viewer) {
    const order = await this.prisma.saleOrder.findUnique({
      where: { id },
      include: { cashier: { select: { name: true } }, items: true, payments: true },
    });
    if (!order) throw new NotFoundException('订单不存在');
    if (viewer.role !== 'BOSS' && order.cashierId !== viewer.id) {
      throw new ForbiddenException('无权查看他人订单');
    }
    return order;
  }

  async findByOrderNo(orderNo: string, viewer: Viewer) {
    const order = await this.prisma.saleOrder.findUnique({
      where: { orderNo },
      include: { cashier: { select: { name: true } }, items: true, payments: true },
    });
    if (!order) throw new NotFoundException('未找到该单号');
    if (viewer.role !== 'BOSS' && order.cashierId !== viewer.id) {
      throw new ForbiddenException('无权查看他人订单');
    }
    return order;
  }

  /** 整单作废（红冲）：仅老板，回补未退库存 */
  async voidOrder(id: string, reason: string, viewer: Viewer) {
    if (viewer.role !== 'BOSS') throw new ForbiddenException('仅老板可作废订单');
    const order = await this.prisma.saleOrder.findUnique({ where: { id }, include: { items: true } });
    if (!order) throw new NotFoundException('订单不存在');
    if (order.status === 'VOID') throw new BadRequestException('订单已作废');

    await this.prisma.$transaction(async (tx) => {
      await tx.saleOrder.update({
        where: { id },
        data: { status: 'VOID', voidReason: reason, voidById: viewer.id },
      });
      for (const item of order.items) {
        const back = item.qty - item.refundedQty;
        if (back <= 0) continue;
        const row = await tx.inventory.upsert({
          where: { skuId: item.skuId },
          create: { skuId: item.skuId, qty: back },
          update: { qty: { increment: back } },
        });
        await tx.inventoryLog.create({
          data: {
            skuId: item.skuId,
            type: 'VOID_BACK',
            change: back,
            after: row.qty,
            refNo: order.orderNo,
            note: `整单作废：${reason}`,
            operatorId: viewer.id,
          },
        });
      }
    });
    await this.audit.log(viewer.id, 'sale.void', order.orderNo, { reason });
    return this.getOrder(id, viewer);
  }

  /** 退货：按原单部分/全部退货，回补库存 */
  async createRefund(dto: CreateRefundDto, viewer: Viewer) {
    const settings = await this.settings.get();
    if (viewer.role === 'CASHIER' && !settings.cashierCanRefund) {
      throw new ForbiddenException('当前设置不允许收银员退货，请老板授权');
    }
    const order = await this.prisma.saleOrder.findUnique({
      where: { id: dto.orderId },
      include: { items: true, payments: true },
    });
    if (!order) throw new NotFoundException('原订单不存在');
    if (order.status === 'VOID') throw new BadRequestException('原订单已作废，不能退货');

    const itemMap = new Map(order.items.map((i) => [i.id, i]));
    const lines = dto.items.map((r) => {
      const item = itemMap.get(r.saleItemId);
      if (!item) throw new BadRequestException('退货明细与原单不符');
      const refundable = item.qty - item.refundedQty;
      if (r.qty > refundable) {
        throw new BadRequestException(`「${item.productName}」最多可退 ${refundable}`);
      }
      return { item, qty: r.qty, subtotal: r.qty * item.unitPrice };
    });
    const amount = lines.reduce((s, l) => s + l.subtotal, 0);

    const refund = await this.prisma.$transaction(async (tx) => {
      const shift = await this.requireOpenShift(tx, viewer.id);
      let created: Prisma.RefundOrderGetPayload<{ include: { items: true } }> | null = null;
      for (let attempt = 0; attempt < 3 && !created; attempt++) {
        try {
          created = await tx.refundOrder.create({
            data: {
              refundNo: genOrderNo('R'),
              orderId: order.id,
              shiftId: shift.id,
              cashierId: viewer.id,
              amount,
              reason: dto.reason,
              method:
                dto.method ?? (order.payments.length === 1 ? order.payments[0].method : 'CASH'),
              items: {
                create: lines.map((l) => ({
                  saleItemId: l.item.id,
                  skuId: l.item.skuId,
                  qty: l.qty,
                  unitPrice: l.item.unitPrice,
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
      if (!created) throw new BadRequestException('退货单号生成失败，请重试');

      for (const l of lines) {
        await tx.saleItem.update({
          where: { id: l.item.id },
          data: { refundedQty: { increment: l.qty } },
        });
        const row = await tx.inventory.upsert({
          where: { skuId: l.item.skuId },
          create: { skuId: l.item.skuId, qty: l.qty },
          update: { qty: { increment: l.qty } },
        });
        await tx.inventoryLog.create({
          data: {
            skuId: l.item.skuId,
            type: 'REFUND',
            change: l.qty,
            after: row.qty,
            refNo: created.refundNo,
            note: `退货：${dto.reason}`,
            operatorId: viewer.id,
          },
        });
      }
      return created;
    });

    await this.audit.log(viewer.id, 'sale.refund', refund.refundNo, {
      orderNo: order.orderNo,
      amount,
      reason: dto.reason,
    });
    return this.getRefund(refund.id, viewer);
  }

  async getRefund(id: string, viewer: Viewer) {
    const refund = await this.prisma.refundOrder.findUnique({
      where: { id },
      include: {
        cashier: { select: { name: true } },
        order: { select: { orderNo: true } },
        items: { include: { saleItem: { select: { productName: true, spec: true } } } },
      },
    });
    if (!refund) throw new NotFoundException('退货单不存在');
    if (viewer.role !== 'BOSS' && refund.cashierId !== viewer.id) {
      throw new ForbiddenException('无权查看');
    }
    return refund;
  }

  listRefunds(viewer: Viewer, q: { from?: string; to?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20)));
    const where: Prisma.RefundOrderWhereInput = {};
    if (viewer.role !== 'BOSS') where.cashierId = viewer.id;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) (where.createdAt as Prisma.DateTimeFilter).gte = new Date(q.from);
      if (q.to) (where.createdAt as Prisma.DateTimeFilter).lte = new Date(q.to);
    }
    return this.prisma.$transaction(async (tx) => {
      const [total, items] = await Promise.all([
        tx.refundOrder.count({ where }),
        tx.refundOrder.findMany({
          where,
          include: {
            cashier: { select: { name: true } },
            order: { select: { orderNo: true } },
            items: { include: { saleItem: { select: { productName: true, spec: true } } } },
          },
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
      return { total, page, pageSize, items };
    });
  }
}
