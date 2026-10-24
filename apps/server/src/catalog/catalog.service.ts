import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { genStoreBarcode, validateBarcode } from '../common/barcode.util';
import {
  CreateCategoryDto,
  ImportDto,
  UpdateCategoryDto,
  UpsertProductDto,
} from './dto/catalog.dto';

type Viewer = { id: string; role: 'BOSS' | 'CASHIER' };

const yuanToFen = (v?: string | null): number | null => {
  if (v === undefined || v === null || `${v}`.trim() === '') return null;
  const n = Math.round(Number(v) * 100);
  if (Number.isNaN(n) || n < 0) throw new BadRequestException(`金额不合法: ${v}`);
  return n;
};

@Injectable()
export class CatalogService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // ---------- 分类 ----------

  listCategories() {
    return this.prisma.category.findMany({
      orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createCategory(dto: CreateCategoryDto) {
    if (dto.parentId) {
      const parent = await this.prisma.category.findUnique({ where: { id: dto.parentId } });
      if (!parent) throw new NotFoundException('父分类不存在');
      if (parent.parentId) throw new BadRequestException('仅支持两级分类');
    }
    return this.prisma.category.create({
      data: { name: dto.name, parentId: dto.parentId, sort: dto.sort ?? 0 },
    });
  }

  async updateCategory(id: string, dto: UpdateCategoryDto) {
    const cat = await this.prisma.category.findUnique({ where: { id } });
    if (!cat) throw new NotFoundException('分类不存在');
    return this.prisma.category.update({
      where: { id },
      data: { name: dto.name, sort: dto.sort ?? cat.sort },
    });
  }

  async deleteCategory(id: string) {
    const [productCount, children] = await Promise.all([
      this.prisma.product.count({ where: { categoryId: id } }),
      this.prisma.category.count({ where: { parentId: id } }),
    ]);
    if (productCount > 0 || children > 0) {
      throw new BadRequestException('分类下仍有商品或子分类，不能删除');
    }
    await this.prisma.category.delete({ where: { id } });
    return { ok: true };
  }

  // ---------- 商品 ----------

  private skuSelect(isBoss: boolean) {
    return {
      id: true,
      productId: true,
      spec: true,
      retailPrice: true,
      memberPrice: true,
      minPrice: true,
      safetyStock: true,
      status: true,
      ...(isBoss ? { lastCost: true, costAvg: true } : {}),
      barcodes: { select: { barcode: true } },
      inventory: { select: { qty: true } },
    } satisfies Prisma.SkuSelect;
  }

  private mapSku(s: { [key: string]: unknown }, isBoss: boolean) {
    const barcodes = (s.barcodes as { barcode: string }[]).map((b) => b.barcode);
    const base = {
      id: s.id as string,
      productId: s.productId as string,
      barcode: barcodes[0] ?? null,
      barcodes,
      spec: (s.spec as string | null) ?? null,
      retailPrice: s.retailPrice as number,
      memberPrice: (s.memberPrice as number | null) ?? null,
      minPrice: (s.minPrice as number | null) ?? null,
      safetyStock: s.safetyStock as number,
      status: s.status as 'ON_SALE' | 'OFF_SALE',
      qty: (s.inventory as { qty: number } | null)?.qty ?? 0,
    };
    if (isBoss) {
      return { ...base, lastCost: s.lastCost as number | null, costAvg: s.costAvg as number | null };
    }
    return base; // 收银员不下发成本字段
  }

  async listProducts(
    viewer: Viewer,
    q: { keyword?: string; categoryId?: string; status?: string; page?: string; pageSize?: string },
  ) {
    const isBoss = viewer.role === 'BOSS';
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20)));
    const where: Prisma.ProductWhereInput = {};
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.status === 'ON_SALE' || q.status === 'OFF_SALE') where.status = q.status;
    if (q.keyword) {
      const kw = q.keyword.trim();
      where.OR = [
        { name: { contains: kw, mode: 'insensitive' as const } },
        { brand: { contains: kw, mode: 'insensitive' as const } },
        { skus: { some: { barcodes: { some: { barcode: kw } } } } },
      ];
    }
    const [total, products] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({
        where,
        include: {
          category: { select: { name: true } },
          skus: { include: { barcodes: true, inventory: true }, orderBy: { createdAt: 'asc' } },
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: products.map((p) => ({
        id: p.id,
        name: p.name,
        brand: p.brand,
        categoryId: p.categoryId,
        categoryName: p.category?.name ?? null,
        unit: p.unit,
        status: p.status,
        remark: p.remark,
        skus: p.skus.map((s) => this.mapSku(s as never, isBoss)),
      })),
    };
  }

  /** 扫码枪命中：按条码精确查询在售 SKU（收银核心接口） */
  async findByBarcode(barcode: string, viewer: Viewer) {
    const sku = await this.prisma.sku.findFirst({
      where: { barcodes: { some: { barcode } } },
      include: {
        product: { select: { name: true, unit: true, status: true } },
        barcodes: true,
        inventory: true,
      },
    });
    if (!sku) return null;
    const isBoss = viewer.role === 'BOSS';
    return {
      sku: this.mapSku(sku as never, isBoss),
      productName: sku.product.name,
      unit: sku.product.unit,
      productStatus: sku.product.status,
    };
  }

  async upsertProduct(dto: UpsertProductDto, viewer: Viewer) {
    if (viewer.role !== 'BOSS') throw new ForbiddenException('仅老板可维护商品');
    // 条码校验与查重
    const inputBarcodes: string[] = [];
    for (const s of dto.skus) {
      if (s.barcode) {
        validateBarcode(s.barcode);
        inputBarcodes.push(s.barcode);
      }
    }
    if (inputBarcodes.length !== new Set(inputBarcodes).size) {
      throw new BadRequestException('条码重复');
    }
    for (const bc of inputBarcodes) {
      const exist = await this.prisma.skuBarcode.findUnique({
        where: { barcode: bc },
        include: { sku: { select: { productId: true } } },
      });
      if (exist && exist.sku.productId !== dto.id) {
        throw new BadRequestException(`条码 ${bc} 已被其他商品使用`);
      }
    }

    const unit = dto.unit ?? '件';
    const productId = await this.prisma.$transaction(async (tx) => {
      let pid = dto.id;
      if (pid) {
        const product = await tx.product.findUnique({ where: { id: pid }, include: { skus: true } });
        if (!product) throw new NotFoundException('商品不存在');
        await tx.product.update({
          where: { id: pid },
          data: {
            name: dto.name,
            brand: dto.brand ?? null,
            categoryId: dto.categoryId ?? null,
            unit,
            status: dto.status ?? 'ON_SALE',
            remark: dto.remark ?? null,
          },
        });
        // 入参未包含的旧 SKU 一律停售（不物理删除，保留历史单据）
        const keepIds = dto.skus.filter((s) => s.id).map((s) => s.id as string);
        const toOff = product.skus.filter((s) => !keepIds.includes(s.id));
        for (const s of toOff) {
          await tx.sku.update({ where: { id: s.id }, data: { status: 'OFF_SALE' } });
        }
      } else {
        pid = (await tx.product.create({
          data: {
            name: dto.name,
            brand: dto.brand ?? null,
            categoryId: dto.categoryId ?? null,
            unit,
            status: dto.status ?? 'ON_SALE',
            remark: dto.remark ?? null,
          },
        })).id;
      }

      for (const s of dto.skus) {
        const data = {
          spec: s.spec ?? null,
          retailPrice: s.retailPrice,
          memberPrice: s.memberPrice ?? null,
          minPrice: s.minPrice ?? null,
          safetyStock: s.safetyStock ?? 0,
          status: s.status ?? 'ON_SALE',
          ...(viewer.role === 'BOSS' && s.cost !== undefined && s.cost !== null
            ? { lastCost: s.cost }
            : {}),
        };
        let skuId = s.id;
        if (skuId) {
          const old = await tx.sku.findUnique({ where: { id: skuId } });
          if (!old) throw new NotFoundException('SKU 不存在');
          await tx.sku.update({ where: { id: skuId }, data });
          if (s.cost !== undefined && s.cost !== null && old.retailPrice !== s.retailPrice) {
            await this.audit.log(viewer.id, 'product.price_change', pid, {
              skuId,
              from: old.retailPrice,
              to: s.retailPrice,
            });
          }
          await tx.skuBarcode.deleteMany({ where: { skuId } });
        } else {
          skuId = (
            await tx.sku.create({
              data: { ...data, productId: pid, lastCost: s.cost ?? null, costAvg: s.cost ?? null },
            })
          ).id;
          // 期初库存
          if (s.initQty) {
            await tx.inventory.create({ data: { skuId, qty: s.initQty } });
            await tx.inventoryLog.create({
              data: {
                skuId,
                type: 'INIT',
                change: s.initQty,
                after: s.initQty,
                note: '新建商品期初库存',
                operatorId: viewer.id,
              },
            });
          } else {
            await tx.inventory.create({ data: { skuId, qty: 0 } });
          }
        }
        if (s.barcode) {
          await tx.skuBarcode.create({ data: { skuId, barcode: s.barcode } });
        }
      }
      return pid;
    });
    await this.audit.log(viewer.id, dto.id ? 'product.update' : 'product.create', productId, {
      name: dto.name,
    });
    return { id: productId };
  }

  // ---------- CSV 批量导入 ----------

  async importRows(dto: ImportDto, viewer: Viewer) {
    if (viewer.role !== 'BOSS') throw new ForbiddenException('仅老板可导入商品');
    let createdProducts = 0;
    let createdSkus = 0;
    let skipped = 0;
    const errors: { row: number; message: string }[] = [];

    for (let i = 0; i < dto.rows.length; i++) {
      const row = dto.rows[i];
      try {
        const name = row.productName?.trim();
        if (!name) throw new Error('商品名为空');
        const retail = yuanToFen(row.retailPrice);
        if (retail === null) throw new Error('零售价为空');
        const cost = yuanToFen(row.cost);
        const member = yuanToFen(row.memberPrice);
        const qty = row.qty ? Math.max(0, Math.round(Number(row.qty))) : 0;
        if (Number.isNaN(qty)) throw new Error('库存数量不合法');
        const safety = row.safetyStock ? Math.max(0, Math.round(Number(row.safetyStock))) : 0;

        const result = await this.prisma.$transaction(async (tx) => {
          // 分类
          let categoryId: string | null = null;
          const catName = row.categoryName?.trim();
          if (catName) {
            let cat = await tx.category.findFirst({ where: { name: catName } });
            if (!cat) cat = await tx.category.create({ data: { name: catName } });
            categoryId = cat.id;
          }
          // 商品
          let product = await tx.product.findFirst({ where: { name } });
          let productCreated = false;
          if (!product) {
            product = await tx.product.create({
              data: {
                name,
                brand: row.brand?.trim() || null,
                categoryId,
                unit: row.unit?.trim() || '件',
              },
            });
            productCreated = true;
          }
          // SKU：条码存在即视为已导入，跳过
          let barcode = row.barcode?.trim() || null;
          if (barcode) validateBarcode(barcode);
          else if (dto.autoBarcode !== false) barcode = genStoreBarcode();

          if (barcode) {
            const exist = await tx.skuBarcode.findUnique({ where: { barcode } });
            if (exist) return { skipped: true } as const;
          }
          let sku = await tx.sku.findFirst({
            where: { productId: product.id, spec: row.spec?.trim() || null },
          });
          if (sku) return { skipped: true } as const;

          sku = await tx.sku.create({
            data: {
              productId: product.id,
              spec: row.spec?.trim() || null,
              retailPrice: retail!,
              memberPrice: member,
              lastCost: cost,
              costAvg: cost,
              safetyStock: safety,
            },
          });
          if (barcode) {
            await tx.skuBarcode.create({ data: { skuId: sku.id, barcode } });
          }
          await tx.inventory.create({ data: { skuId: sku.id, qty } });
          if (qty > 0) {
            await tx.inventoryLog.create({
              data: {
                skuId: sku.id,
                type: 'IMPORT',
                change: qty,
                after: qty,
                note: 'CSV 批量导入期初',
                operatorId: viewer.id,
              },
            });
          }
          return { skipped: false, productCreated } as const;
        });

        if (result.skipped) skipped++;
        else {
          createdSkus++;
          if (result.productCreated) createdProducts++;
        }
      } catch (e) {
        errors.push({ row: i + 1, message: e instanceof Error ? e.message : String(e) });
      }
    }
    await this.audit.log(viewer.id, 'product.import', undefined, {
      rows: dto.rows.length,
      createdProducts,
      createdSkus,
      skipped,
      failed: errors.length,
    });
    return { createdProducts, createdSkus, skipped, errors };
  }
}
