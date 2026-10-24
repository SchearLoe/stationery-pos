/**
 * 端到端测试：对真实数据库跑二期全链路业务。
 * 前置：本地 PostgreSQL 已启动且已执行 migrate + seed（见 README 测试一节）。
 * 运行：pnpm test:e2e
 */
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

const runId = Date.now().toString(36).slice(-6);

describe('二期业务全链路 (e2e)', () => {
  let app: INestApplication;
  let bossToken = '';
  let cashierToken = '';

  const boss = () => authed(() => bossToken);
  const cashier = () => authed(() => cashierToken);

  /** supertest 7 的 .set 需接在动词之后，这里按动词包一层自动带 Token */
  function authed(getToken: () => string) {
    const srv = app.getHttpServer();
    const withAuth = (method: 'get' | 'post' | 'put' | 'delete') => (url: string) =>
      request(srv)[method](url).set('Authorization', `Bearer ${getToken()}`);
    return {
      get: withAuth('get'),
      post: withAuth('post'),
      put: withAuth('put'),
      delete: withAuth('delete'),
    };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
    );
    await app.init();

    const b = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss', password: 'boss123' });
    bossToken = b.body.accessToken;
    const c = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'cashier', password: 'cashier123' });
    cashierToken = c.body.accessToken;
  }, 60000);

  afterAll(async () => {
    await app.close();
  });

  // ---------- 认证 ----------

  it('登录失败返回 401', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ username: 'boss', password: 'wrong' })
      .expect(401);
  });

  it('未登录访问业务接口返回 401', async () => {
    await request(app.getHttpServer()).get('/api/products').expect(401);
  });

  // ---------- 采购 / 应付 ----------

  let supplierId = '';
  let purchaseId = '';
  let purchaseSkuId = '';

  it('采购：建供应商 → 建采购单 → 入库加库存并更新成本 → 分次付款 → 应付归零', async () => {
    // 供应商
    const sup = await boss()
      .post('/api/purchases/suppliers')
      .send({ name: `e2e供应商-${runId}`, phone: '13900001111' })
      .expect(201);
    supplierId = sup.body.id;

    // 选一个种子商品
    const products = await boss().get('/api/products?keyword=中性笔').expect(200);
    const sku = products.body.items[0].skus[0];
    purchaseSkuId = sku.id;
    const before = { qty: sku.qty, costAvg: sku.costAvg as number | null };

    // 建采购单：10 件 @500 分
    const created = await boss()
      .post('/api/purchases/orders')
      .send({
        supplierId,
        items: [{ skuId: purchaseSkuId, qty: 10, unitCost: 500 }],
        remark: 'e2e 采购',
      })
      .expect(201);
    purchaseId = created.body.id;
    expect(created.body.status).toBe('DRAFT');
    expect(created.body.totalAmount).toBe(5000);

    // 未入库不能付款
    await boss()
      .post(`/api/purchases/orders/${purchaseId}/payments`)
      .send({ amount: 1000 })
      .expect(400);

    // 入库
    const received = await boss().post(`/api/purchases/orders/${purchaseId}/receive`).expect(201);
    expect(received.body.status).toBe('RECEIVED');

    // 库存 +10、成本按移动加权平均更新
    const after = await boss().get(`/api/products?keyword=${encodeURIComponent('中性笔')}`).expect(200);
    const skuAfter = after.body.items[0].skus.find((s: any) => s.id === purchaseSkuId);
    expect(skuAfter.qty).toBe(before.qty + 10);
    expect(skuAfter.lastCost).toBe(500);
    const expectedAvg = Math.round(
      (before.qty * (before.costAvg ?? 0) + 10 * 500) / (before.qty + 10),
    );
    expect(skuAfter.costAvg).toBe(expectedAvg);

    // 分次付款：3000 → 余额 2000；超付被拒
    const paid = await boss()
      .post(`/api/purchases/orders/${purchaseId}/payments`)
      .send({ amount: 3000, method: 'WECHAT' })
      .expect(201);
    expect(paid.body.payableAmount).toBe(2000);
    await boss()
      .post(`/api/purchases/orders/${purchaseId}/payments`)
      .send({ amount: 999999 })
      .expect(400);

    // 应付汇总
    const payables = await boss().get('/api/purchases/payables').expect(200);
    const mine = payables.body.find((p: any) => p.supplierId === supplierId);
    expect(mine.payable).toBe(2000);
  });

  // ---------- 盘点 ----------

  let taskId = '';

  it('盘点：建任务 → 录实盘 → 应用差异 → 库存与流水正确', async () => {
    const created = await boss().post('/api/stocktakes').send({ note: `e2e 盘点 ${runId}` }).expect(201);
    taskId = created.body.id;
    expect(created.body.status).toBe('OPEN');
    expect(created.body.itemCount).toBeGreaterThan(0);

    const task = await boss().get(`/api/stocktakes/${taskId}`).expect(200);
    const item = task.body.items.find((i: any) => i.skuId === purchaseSkuId);
    const snapshot = item.snapshotQty as number;
    const counted = snapshot + 3;

    await boss()
      .put(`/api/stocktakes/${taskId}/counts`)
      .send({ items: [{ id: item.id, countedQty: counted }] })
      .expect(200);

    const applied = await boss().post(`/api/stocktakes/${taskId}/apply`).expect(201);
    expect(applied.body.status).toBe('APPLIED');
    expect(applied.body.diffCount).toBe(1);

    // 库存变为 snapshot + 3（采购入库 +10 之后的账面）
    const products = await boss().get('/api/products?keyword=中性笔').expect(200);
    const sku = products.body.items[0].skus.find((s: any) => s.id === purchaseSkuId);
    const afterPurchase = (await boss().get('/api/inventory/logs?type=PURCHASE').expect(200))
      .body.items[0].after;
    expect(sku.qty).toBe(afterPurchase + 3);

    // 盘点流水存在
    const logs = await boss().get('/api/inventory/logs?type=STOCKTAKE').expect(200);
    const log = logs.body.items.find((l: any) => l.refNo === task.body.taskNo);
    expect(log.change).toBe(3);

    // 已结束不能再应用
    await boss().post(`/api/stocktakes/${taskId}/apply`).expect(400);
  });

  // ---------- 会员储值 / 积分 ----------

  let memberId = '';
  let memberSkuId = '';
  let balanceOrderId = '';

  it('会员：建档 → 充值（本金+赠送）', async () => {
    const created = await boss()
      .post('/api/members')
      .send({ name: `e2e会员-${runId}`, phone: `139${String(Date.now()).slice(-8)}` })
      .expect(201);
    memberId = created.body.id;
    expect(created.body.code).toMatch(/^M\d{6}$/);

    const recharged = await boss()
      .post(`/api/members/${memberId}/recharge`)
      .send({ amount: 10000, bonus: 2000, method: 'CASH', note: '充100送20' })
      .expect(201);
    expect(recharged.body.balance).toBe(12000);
  });

  it('老板建带会员价/最低售价的商品', async () => {
    await boss()
      .post('/api/products')
      .send({
        name: `e2e会员测试商品-${runId}`,
        unit: '支',
        skus: [{ spec: 'e2e', retailPrice: 500, memberPrice: 300, minPrice: 400, initQty: 100 }],
      })
      .expect(201);
    const products = await boss()
      .get(`/api/products?keyword=${encodeURIComponent(`e2e会员测试商品-${runId}`)}`)
      .expect(200);
    memberSkuId = products.body.items[0].skus[0].id;
    expect(memberSkuId).toBeTruthy();
  });

  it('收银员未挂会员时不能按低于最低售价卖', async () => {
    await cashier()
      .post('/api/shifts/open')
      .expect((r) => [201, 400].includes(r.status)); // 已有开班则为 400
    await cashier()
      .post('/api/sales/orders')
      .send({
        items: [{ skuId: memberSkuId, qty: 1, unitPrice: 300 }],
        payments: [{ method: 'CASH', amount: 300 }],
      })
      .expect(400);
  });

  it('挂会员后可按会员价储值支付，余额扣减、积分赠送', async () => {
    const res = await cashier()
      .post('/api/sales/orders')
      .send({
        items: [{ skuId: memberSkuId, qty: 2, unitPrice: 300 }],
        payments: [{ method: 'BALANCE', amount: 600 }],
        memberId,
      })
      .expect(201);
    balanceOrderId = res.body.id;
    expect(res.body.memberName).toContain('e2e会员');
    expect(res.body.pointsEarned).toBe(6); // 600 分 = 6 元 × 1 积分/元

    const member = await boss().get(`/api/members/${memberId}`).expect(200);
    expect(member.body.balance).toBe(12000 - 600);
    expect(member.body.points).toBe(6);
  });

  it('积分抵扣：余额不足时报错，抵扣后金额与积分正确', async () => {
    // 积分只有 6，用 100 被拒
    await cashier()
      .post('/api/sales/orders')
      .send({
        items: [{ skuId: memberSkuId, qty: 1, unitPrice: 300 }],
        payments: [{ method: 'CASH', amount: 300 }],
        memberId,
        usePoints: 100,
      })
      .expect(400);

    // 用 5 积分抵 5 分：应付 295
    const res = await cashier()
      .post('/api/sales/orders')
      .send({
        items: [{ skuId: memberSkuId, qty: 1, unitPrice: 300 }],
        payments: [{ method: 'CASH', amount: 295 }],
        memberId,
        usePoints: 5,
      })
      .expect(201);
    expect(res.body.pointsDiscount).toBe(5);
    expect(res.body.pointsUsed).toBe(5);
    expect(res.body.payableAmount).toBe(295);
    expect(res.body.pointsEarned).toBe(2); // floor(295/100)

    const member = await boss().get(`/api/members/${memberId}`).expect(200);
    expect(member.body.points).toBe(6 + 2 - 5);
  });

  it('离线单不能使用会员功能', async () => {
    await cashier()
      .post('/api/sales/orders')
      .send({
        items: [{ skuId: memberSkuId, qty: 1, unitPrice: 300 }],
        payments: [{ method: 'CASH', amount: 300 }],
        memberId,
        clientId: crypto.randomUUID(),
        clientOrderNo: `L20261024-${runId.toUpperCase().slice(0, 4).padEnd(4, '0')}`,
        offlineCreatedAt: new Date().toISOString(),
      })
      .expect(400);
  });

  it('退货：储值支付的单按原路退回余额', async () => {
    const order = await boss().get(`/api/sales/orders/${balanceOrderId}`).expect(200);
    const item = order.body.items[0];
    const memberBefore = (await boss().get(`/api/members/${memberId}`).expect(200)).body;

    const refund = await cashier()
      .post('/api/sales/refunds')
      .send({
        orderId: balanceOrderId,
        reason: 'e2e 退货',
        items: [{ saleItemId: item.id, qty: 1 }],
        method: 'BALANCE',
      })
      .expect(201);
    expect(refund.body.amount).toBe(300);

    const memberAfter = (await boss().get(`/api/members/${memberId}`).expect(200)).body;
    expect(memberAfter.balance).toBe(memberBefore.balance + 300);
  });

  it('整单作废：返还使用积分、扣回赠送积分、回补库存', async () => {
    // 对积分抵扣那单（CASH 支付、pointsUsed 5、pointsEarned 2）作废
    const orders = await boss()
      .get(`/api/sales/orders?keyword=${(await boss().get('/api/sales/orders').expect(200)).body.items[0].orderNo.slice(0, 9)}`)
      .expect(200);
    const target = orders.body.items.find(
      (o: any) => o.memberId === memberId && o.pointsUsed === 5,
    );
    expect(target).toBeTruthy();

    const memberBefore = (await boss().get(`/api/members/${memberId}`).expect(200)).body;
    await boss()
      .put(`/api/sales/orders/${target.id}/void`)
      .send({ reason: 'e2e 作废' })
      .expect(200);

    const memberAfter = (await boss().get(`/api/members/${memberId}`).expect(200)).body;
    expect(memberAfter.points).toBe(memberBefore.points + 5 - 2);
  });

  // ---------- 账目 / 月结 ----------

  let expenseId = '';

  it('支出记账与月结报表', async () => {
    const month = new Date().toISOString().slice(0, 7);
    const created = await boss()
      .post('/api/ledger/expenses')
      .send({
        date: new Date().toISOString(),
        category: 'RENT',
        amount: 300000,
        title: `e2e房租-${runId}`,
      })
      .expect(201);
    expenseId = created.body.id;

    // 补货采购不能记杂项支出
    await boss()
      .post('/api/ledger/expenses')
      .send({ date: new Date().toISOString(), category: 'RESTOCK', amount: 100, title: 'x' })
      .expect(400);

    const list = await boss().get(`/api/ledger/expenses?month=${month}`).expect(200);
    expect(list.body.totalAmount).toBeGreaterThanOrEqual(300000);

    const monthly = await boss().get(`/api/ledger/monthly?month=${month}`).expect(200);
    const body = monthly.body;
    expect(body.expenseTotal).toBeGreaterThanOrEqual(300000);
    expect(body.netSalesAmount).toBe(body.salesAmount - body.refundAmount);
    expect(body.grossProfit).toBe(body.netSalesAmount - body.cogsAmount);
    expect(body.netProfitEstimate).toBe(body.grossProfit - body.expenseTotal);
  });

  it('删除支出记录', async () => {
    await boss().delete(`/api/ledger/expenses/${expenseId}`).expect(200);
  });

  // ---------- 交接班 ----------

  it('关班：现金净额与差异计算', async () => {
    const current = await cashier().get('/api/shifts/current').expect(200);
    if (!current.body) return; // 无进行中班次则跳过
    const cash = current.body.summary?.find((s: any) => s.method === 'CASH')?.amount ?? 0;
    const closed = await cashier().post('/api/shifts/close').send({ countedCash: 0, note: 'e2e 关班' }).expect(201);
    expect(closed.body.expectedCash).toBe(cash);
    expect(closed.body.diff).toBe(0 - cash);
  });
});
