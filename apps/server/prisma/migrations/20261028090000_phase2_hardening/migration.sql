-- 二期加固：分批到货 + 会员余额/积分非负兜底
-- 1) 采购明细增加已入库数量（支持一张订单多次到货）
ALTER TABLE "PurchaseItem" ADD COLUMN "receivedQty" INTEGER NOT NULL DEFAULT 0;

-- 2) 会员储值余额与积分不允许为负（数据库层兜底应用层并发窗口）
ALTER TABLE "Member" ADD CONSTRAINT "member_balance_nonneg" CHECK ("balance" >= 0);
ALTER TABLE "Member" ADD CONSTRAINT "member_points_nonneg" CHECK ("points" >= 0);
