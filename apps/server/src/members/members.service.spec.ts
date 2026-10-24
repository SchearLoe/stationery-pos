import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { MembersService } from './members.service';

function makePrismaMock() {
  const prisma: any = {};
  prisma.$transaction = jest.fn((arg: any) => (Array.isArray(arg) ? Promise.all(arg) : arg(prisma)));
  prisma.member = {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    count: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  prisma.memberTxn = { create: jest.fn(), findMany: jest.fn(), count: jest.fn(), aggregate: jest.fn() };
  return prisma;
}

const boss = { id: 'boss-1', role: 'BOSS' as const };
const cashier = { id: 'c-1', role: 'CASHIER' as const };
const audit = { log: jest.fn().mockResolvedValue(undefined) };

describe('MembersService', () => {
  let prisma: ReturnType<typeof makePrismaMock>;
  let service: MembersService;

  beforeEach(() => {
    prisma = makePrismaMock();
    audit.log.mockClear();
    service = new MembersService(prisma, audit as never);
  });

  it('收银员不能充值/调整/删改会员', async () => {
    await expect(service.recharge(cashier, 'm1', { amount: 100 })).rejects.toThrow(ForbiddenException);
    await expect(service.adjust(cashier, 'm1', { note: 'x', balanceDelta: 1 })).rejects.toThrow(ForbiddenException);
    await expect(service.create(cashier, { name: '张三' })).rejects.toThrow(ForbiddenException);
  });

  describe('recharge', () => {
    it('本金+赠送一起入余额，写 RECHARGE 流水', async () => {
      prisma.member.findUnique.mockResolvedValue({ id: 'm1', active: true, balance: 5000, points: 10 });
      prisma.member.update.mockResolvedValue({ id: 'm1', balance: 17000, points: 10 });
      prisma.memberTxn.create.mockResolvedValue({});

      const result = await service.recharge(boss, 'm1', { amount: 10000, bonus: 2000 });

      expect(prisma.member.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { balance: { increment: 12000 } } }),
      );
      expect(prisma.memberTxn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'RECHARGE',
            amount: 12000,
            balanceAfter: 17000,
          }),
        }),
      );
      expect(result.balance).toBe(17000);
    });

    it('赠送金额为负或充值金额非正时报错', async () => {
      await expect(service.recharge(boss, 'm1', { amount: 0 })).rejects.toThrow(BadRequestException);
      await expect(service.recharge(boss, 'm1', { amount: 100, bonus: -1 })).rejects.toThrow(BadRequestException);
    });

    it('停用会员不能充值', async () => {
      prisma.member.findUnique.mockResolvedValue({ id: 'm1', active: false });
      await expect(service.recharge(boss, 'm1', { amount: 100 })).rejects.toThrow(/已停用/);
    });
  });

  describe('adjust（人工调整）', () => {
    it('调整后余额不能为负', async () => {
      prisma.member.findUnique.mockResolvedValue({ id: 'm1', balance: 1000, points: 0 });
      await expect(
        service.adjust(boss, 'm1', { balanceDelta: -2000, note: '纠错' }),
      ).rejects.toThrow(/余额不能为负/);
    });

    it('调整后积分不能为负', async () => {
      prisma.member.findUnique.mockResolvedValue({ id: 'm1', balance: 1000, points: 5 });
      await expect(
        service.adjust(boss, 'm1', { pointsDelta: -10, note: '纠错' }),
      ).rejects.toThrow(/积分不能为负/);
    });

    it('正常调整写 ADJUST 流水（余额+积分）', async () => {
      prisma.member.findUnique.mockResolvedValue({ id: 'm1', balance: 1000, points: 5 });
      prisma.member.update.mockResolvedValue({ id: 'm1', balance: 900, points: 15 });
      prisma.memberTxn.create.mockResolvedValue({});

      await service.adjust(boss, 'm1', { balanceDelta: -100, pointsDelta: 10, note: '充值错额更正' });

      expect(prisma.member.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { balance: { increment: -100 }, points: { increment: 10 } },
        }),
      );
      expect(prisma.memberTxn.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'ADJUST',
            amount: -100,
            pointsChange: 10,
            balanceAfter: 900,
            pointsAfter: 15,
          }),
        }),
      );
    });
  });

  describe('create', () => {
    it('手机号重复时报错', async () => {
      prisma.member.findFirst.mockResolvedValue({ id: 'old' });
      await expect(service.create(boss, { name: '张三', phone: '13800000001' })).rejects.toThrow(
        /已是会员/,
      );
    });

    it('会员码冲突时重试生成', async () => {
      prisma.member.findFirst.mockResolvedValue(null);
      const conflict = new Prisma.PrismaClientKnownRequestError('unique constraint', {
        code: 'P2002',
        clientVersion: 'test',
      });
      prisma.member.create
        .mockRejectedValueOnce(conflict)
        .mockResolvedValueOnce({ id: 'm2', code: 'M000002', name: '李四' });
      const member = await service.create(boss, { name: '李四' });
      expect(member.code).toBe('M000002');
      expect(prisma.member.create).toHaveBeenCalledTimes(2);
    });
  });

  describe('findByCodeOrPhone（收银台挂单）', () => {
    it('支持会员码（不区分大小写）和手机号', async () => {
      prisma.member.findFirst.mockResolvedValue({ id: 'm1', code: 'M000001', name: '张老师' });
      await service.findByCodeOrPhone(cashier, 'm000001');
      expect(prisma.member.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { OR: [{ code: 'M000001' }, { phone: 'm000001' }], active: true },
        }),
      );
    });
  });
});
