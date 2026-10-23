/**
 * 种子数据：默认账号（老板/收银员）+ 文体类目 + 示例商品。
 * 仅用于初始化，生产环境请立即修改默认密码。
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const CATEGORIES = [
  '书写工具',
  '纸制品',
  '办公文具',
  '美术用品',
  '学生用品',
  '体育用品',
  '玩具',
  '其他',
];

const DEMO_PRODUCTS = [
  { category: '书写工具', name: '晨光中性笔 K35', brand: '晨光', unit: '支', spec: '黑色 0.5mm', retail: 2.5, cost: 1.2, qty: 200, safety: 30, barcode: '6901234567892' },
  { category: '书写工具', name: '晨光中性笔 K35', brand: '晨光', unit: '支', spec: '蓝色 0.5mm', retail: 2.5, cost: 1.2, qty: 150, safety: 30, barcode: '6901234567908' },
  { category: '书写工具', name: '真彩2B铅笔', brand: '真彩', unit: '支', spec: '考试专用', retail: 1, cost: 0.4, qty: 300, safety: 50, barcode: null },
  { category: '纸制品', name: '得力A4复印纸', brand: '得力', unit: '包', spec: '70g 500张', retail: 18, cost: 12, qty: 40, safety: 10, barcode: '6901234567915' },
  { category: '纸制品', name: '软抄本B5', brand: '得力', unit: '本', spec: '40页', retail: 3.5, cost: 1.8, qty: 80, safety: 20, barcode: null },
  { category: '美术用品', name: '马可雷诺阿彩铅', brand: '马可', unit: '盒', spec: '48色', retail: 68, cost: 42, qty: 15, safety: 5, barcode: '6901234567922' },
  { category: '学生用品', name: '晨光修正带', brand: '晨光', unit: '个', spec: '12m×5mm', retail: 3, cost: 1.5, qty: 100, safety: 20, barcode: '6901234567939' },
  { category: '体育用品', name: '火车头跳绳', brand: '火车头', unit: '根', spec: '2.5m 可调', retail: 12, cost: 6.5, qty: 25, safety: 5, barcode: null },
  { category: '玩具', name: '魔方三阶', brand: 'GAN', unit: '个', spec: '磁力版', retail: 45, cost: 25, qty: 10, safety: 3, barcode: '6901234567946' },
];

async function main() {
  // 账号
  const bossPass = await bcrypt.hash('boss123', 10);
  const cashierPass = await bcrypt.hash('cashier123', 10);
  const boss = await prisma.user.upsert({
    where: { username: 'boss' },
    update: {},
    create: { username: 'boss', passwordHash: bossPass, name: '老板', role: 'BOSS' },
  });
  await prisma.user.upsert({
    where: { username: 'cashier' },
    update: {},
    create: { username: 'cashier', passwordHash: cashierPass, name: '收银员小王', role: 'CASHIER' },
  });

  // 类目
  const catMap = new Map<string, string>();
  for (let i = 0; i < CATEGORIES.length; i++) {
    const name = CATEGORIES[i]!;
    const exist = await prisma.category.findFirst({ where: { name } });
    const cat =
      exist ??
      (await prisma.category.create({ data: { name, sort: i } }));
    catMap.set(name, cat.id);
  }

  // 示例商品（仅首次初始化时插入）
  const productCount = await prisma.product.count();
  if (productCount === 0) {
    for (const p of DEMO_PRODUCTS) {
      const product = await prisma.product.create({
        data: {
          name: p.name,
          brand: p.brand,
          categoryId: catMap.get(p.category) ?? null,
          unit: p.unit,
        },
      });
      const sku = await prisma.sku.create({
        data: {
          productId: product.id,
          spec: p.spec,
          retailPrice: Math.round(p.retail * 100),
          lastCost: Math.round(p.cost * 100),
          costAvg: Math.round(p.cost * 100),
          safetyStock: p.safety,
        },
      });
      if (p.barcode) {
        await prisma.skuBarcode.create({ data: { skuId: sku.id, barcode: p.barcode } });
      }
      await prisma.inventory.create({ data: { skuId: sku.id, qty: p.qty } });
      await prisma.inventoryLog.create({
        data: {
          skuId: sku.id,
          type: 'INIT',
          change: p.qty,
          after: p.qty,
          note: '演示数据期初',
          operatorId: boss.id,
        },
      });
    }
    console.log(`已插入 ${DEMO_PRODUCTS.length} 个演示商品`);
  }

  console.log('种子数据完成：');
  console.log('  老板账号   boss / boss123');
  console.log('  收银员账号 cashier / cashier123');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
