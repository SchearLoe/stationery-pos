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

type Viewer = { id: string; role: 'BOSS' | 'CASHIER' };

@Injectable()
export class StocktakeService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private requireBoss(viewer: Viewer) {
    if (viewer.role !== 'BOSS') throw new ForbiddenException('仅老板可管理盘点任务');
  }

  /** 建盘点任务：按类目圈定范围，快照当前账面库存（含停售，便于全店清点） */
  async create(viewer: Viewer, input: { categoryId?: string; note?: string }) {
    this.requireBoss(viewer);
    const where: Prisma.SkuWhereInput = {};
    if (input.categoryId) where.product = { categoryId: input.categoryId };
    const skus = await this.prisma.sku.findMany({
      where,
      include: {
        product: { select: { name: true, unit: true } },
        inventory: { select: { qty: true } },
      },
      orderBy: [{ product: { name: 'asc' } }, { spec: 'asc' }],
    });
    if (skus.length === 0) throw new BadRequestException('范围内没有可盘点的商品');

    const task = await this.prisma.$transaction(async (tx) => {
      let created: Prisma.StocktakeTaskGetPayload<{ include: { items: true } }> | null = null;
      for (let attempt = 0; attempt < 3 && !created; attempt++) {
        try {
          created = await tx.stocktakeTask.create({
            data: {
              taskNo: genOrderNo('T'),
              status: 'OPEN',
              scopeCategoryId: input.categoryId ?? null,
              note: input.note ?? null,
              creatorId: viewer.id,
              items: {
                create: skus.map((s) => ({
                  skuId: s.id,
                  productName: s.product.name,
                  spec: s.spec,
                  unit: s.product.unit,
                  snapshotQty: s.inventory?.qty ?? 0,
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
      if (!created) throw new BadRequestException('盘点单号生成失败，请重试');
      return created;
    });

    await this.audit.log(viewer.id, 'stocktake.create', task.taskNo, {
      items: skus.length,
      categoryId: input.categoryId,
    });
    return this.getTask(viewer, task.id);
  }

  async list(viewer: Viewer, q: { status?: string; page?: string; pageSize?: string }) {
    this.requireBoss(viewer);
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(50, Math.max(1, Number(q.pageSize ?? 20)));
    const where: Prisma.StocktakeTaskWhereInput = {};
    if (q.status) where.status = q.status as Prisma.StocktakeTaskWhereInput['status'];
    const [total, tasks] = await Promise.all([
      this.prisma.stocktakeTask.count({ where }),
      this.prisma.stocktakeTask.findMany({
        where,
        include: {
          scopeCategory: { select: { name: true } },
          creator: { select: { name: true } },
          items: { select: { countedQty: true, snapshotQty: true } },
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
      items: tasks.map((t) => ({
        id: t.id,
        taskNo: t.taskNo,
        status: t.status,
        scopeCategoryId: t.scopeCategoryId,
        scopeCategoryName: t.scopeCategory?.name ?? null,
        note: t.note,
        creatorName: t.creator?.name ?? null,
        appliedAt: t.appliedAt,
        createdAt: t.createdAt,
        itemCount: t.items.length,
        countedCount: t.items.filter((i) => i.countedQty !== null).length,
        diffCount: t.items.filter(
          (i) => i.countedQty !== null && i.countedQty !== i.snapshotQty,
        ).length,
      })),
    };
  }

  async getTask(viewer: Viewer, id: string) {
    this.requireBoss(viewer);
    const task = await this.prisma.stocktakeTask.findUnique({
      where: { id },
      include: {
        scopeCategory: { select: { name: true } },
        creator: { select: { name: true } },
        items: {
          include: { sku: { include: { barcodes: { select: { barcode: true }, orderBy: { createdAt: 'asc' } } } } },
          orderBy: [{ productName: 'asc' }, { spec: 'asc' }],
        },
      },
    });
    if (!task) throw new NotFoundException('盘点任务不存在');
    return {
      id: task.id,
      taskNo: task.taskNo,
      status: task.status,
      scopeCategoryId: task.scopeCategoryId,
      scopeCategoryName: task.scopeCategory?.name ?? null,
      note: task.note,
      creatorName: task.creator?.name ?? null,
      appliedAt: task.appliedAt,
      createdAt: task.createdAt,
      itemCount: task.items.length,
      countedCount: task.items.filter((i) => i.countedQty !== null).length,
      diffCount: task.items.filter(
        (i) => i.countedQty !== null && i.countedQty !== i.snapshotQty,
      ).length,
      items: task.items.map((i) => ({
        id: i.id,
        skuId: i.skuId,
        productName: i.productName,
        spec: i.spec,
        barcode: i.sku.barcodes[0]?.barcode ?? null,
        unit: i.unit,
        snapshotQty: i.snapshotQty,
        countedQty: i.countedQty,
        diff: i.countedQty === null ? null : i.countedQty - i.snapshotQty,
      })),
    };
  }

  /** 保存实盘数量（可分批保存，未盘项保持 null） */
  async saveCounts(
    viewer: Viewer,
    id: string,
    input: { items: { id: string; countedQty: number | null }[] },
  ) {
    this.requireBoss(viewer);
    const task = await this.prisma.stocktakeTask.findUnique({
      where: { id },
      include: { items: { select: { id: true } } },
    });
    if (!task) throw new NotFoundException('盘点任务不存在');
    if (task.status !== 'OPEN') throw new BadRequestException('盘点任务已结束，不能再录入');
    const validIds = new Set(task.items.map((i) => i.id));
    await this.prisma.$transaction(
      input.items
        .filter((i) => validIds.has(i.id))
        .map((i) =>
          this.prisma.stocktakeItem.update({
            where: { id: i.id },
            data: { countedQty: i.countedQty === null ? null : Math.max(0, Math.floor(i.countedQty)) },
          }),
        ),
    );
    return this.getTask(viewer, id);
  }

  /** 应用盘点差异：仅对「已录入且与快照不同」的项生成库存调整（type=STOCKTAKE） */
  async apply(viewer: Viewer, id: string) {
    this.requireBoss(viewer);
    const task = await this.prisma.stocktakeTask.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!task) throw new NotFoundException('盘点任务不存在');
    if (task.status !== 'OPEN') throw new BadRequestException('盘点任务已结束');
    const diffs = task.items.filter(
      (i) => i.countedQty !== null && i.countedQty !== i.snapshotQty,
    );
    if (diffs.length === 0) {
      throw new BadRequestException('没有可应用的差异（未录入或与账面一致），如不需要可取消任务');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const item of diffs) {
        const row = await tx.inventory.upsert({
          where: { skuId: item.skuId },
          create: { skuId: item.skuId, qty: item.countedQty! },
          update: { qty: item.countedQty! },
        });
        await tx.inventoryLog.create({
          data: {
            skuId: item.skuId,
            type: 'STOCKTAKE',
            change: item.countedQty! - item.snapshotQty,
            after: row.qty,
            refNo: task.taskNo,
            note: `盘点（${item.snapshotQty} → ${item.countedQty}）`,
            operatorId: viewer.id,
          },
        });
      }
      await tx.stocktakeTask.update({
        where: { id },
        data: { status: 'APPLIED', appliedAt: new Date() },
      });
    });

    await this.audit.log(viewer.id, 'stocktake.apply', task.taskNo, {
      diffItems: diffs.length,
      totalDiff: diffs.reduce((n, d) => n + (d.countedQty! - d.snapshotQty), 0),
    });
    return this.getTask(viewer, id);
  }

  async cancel(viewer: Viewer, id: string) {
    this.requireBoss(viewer);
    const task = await this.prisma.stocktakeTask.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('盘点任务不存在');
    if (task.status !== 'OPEN') throw new BadRequestException('盘点任务已结束，不能取消');
    await this.prisma.stocktakeTask.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.log(viewer.id, 'stocktake.cancel', task.taskNo, null);
    return this.getTask(viewer, id);
  }
}
