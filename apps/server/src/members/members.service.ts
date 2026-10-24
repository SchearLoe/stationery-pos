import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma.module';
import { AuditService } from '../common/audit.service';
import { genMemberCode } from '../common/barcode.util';

type Viewer = { id: string; role: 'BOSS' | 'CASHIER' };

@Injectable()
export class MembersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private requireBoss(viewer: Viewer) {
    if (viewer.role !== 'BOSS') throw new ForbiddenException('仅老板可操作会员账户');
  }

  /** 会员查询：收银台挂单会员也用它（收银员只读 + 本人可见余额为店内公开信息） */
  async list(viewer: Viewer, q: { keyword?: string; page?: string; pageSize?: string }) {
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 20)));
    const where: Prisma.MemberWhereInput = {};
    if (q.keyword?.trim()) {
      const kw = q.keyword.trim();
      where.OR = [
        { name: { contains: kw, mode: 'insensitive' as const } },
        { phone: { contains: kw } },
        { code: { startsWith: kw.toUpperCase() } },
      ];
    }
    const [total, members] = await Promise.all([
      this.prisma.member.count({ where }),
      this.prisma.member.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items: members };
  }

  async get(viewer: Viewer, id: string) {
    const member = await this.prisma.member.findUnique({ where: { id } });
    if (!member) throw new NotFoundException('会员不存在');
    return member;
  }

  /** 收银台按手机号/会员码精确挂单（扫码枪扫会员卡场景） */
  async findByCodeOrPhone(viewer: Viewer, key: string) {
    const member = await this.prisma.member.findFirst({
      where: { OR: [{ code: key.toUpperCase() }, { phone: key }], active: true },
    });
    if (!member) throw new NotFoundException('未找到该会员');
    return member;
  }

  async create(viewer: Viewer, dto: { name: string; phone?: string | null; remark?: string | null }) {
    this.requireBoss(viewer);
    if (dto.phone) {
      const dup = await this.prisma.member.findFirst({ where: { phone: dto.phone } });
      if (dup) throw new BadRequestException('该手机号已是会员');
    }
    const member = await this.prisma.$transaction(async (tx) => {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return await tx.member.create({
            data: { code: genMemberCode(), name: dto.name, phone: dto.phone ?? null, remark: dto.remark ?? null },
          });
        } catch (e) {
          const isUniqueConflict =
            e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
          if (!isUniqueConflict || attempt === 4) throw e;
        }
      }
      throw new BadRequestException('会员码生成失败，请重试');
    });
    await this.audit.log(viewer.id, 'member.create', member.id, { name: dto.name });
    return member;
  }

  async update(
    viewer: Viewer,
    id: string,
    dto: { name?: string; phone?: string | null; remark?: string | null; active?: boolean },
  ) {
    this.requireBoss(viewer);
    const member = await this.prisma.member
      .update({ where: { id }, data: dto })
      .catch(() => {
        throw new NotFoundException('会员不存在');
      });
    await this.audit.log(viewer.id, 'member.update', id, dto as never);
    return member;
  }

  /** 充值：本金入余额 + 可选赠送金额；充值收款方式仅做记录（门店线下收钱） */
  async recharge(
    viewer: Viewer,
    id: string,
    dto: { amount: number; bonus?: number; method?: 'CASH' | 'WECHAT' | 'ALIPAY' | 'CARD' | 'OTHER'; note?: string },
  ) {
    this.requireBoss(viewer);
    if (dto.amount <= 0) throw new BadRequestException('充值金额必须大于 0');
    if ((dto.bonus ?? 0) < 0) throw new BadRequestException('赠送金额不合法');
    const result = await this.prisma.$transaction(async (tx) => {
      const member = await tx.member.findUnique({ where: { id } });
      if (!member || !member.active) throw new BadRequestException('会员不存在或已停用');
      const addUp = dto.amount + (dto.bonus ?? 0);
      const updated = await tx.member.update({
        where: { id },
        data: { balance: { increment: addUp } },
      });
      await tx.memberTxn.create({
        data: {
          memberId: id,
          type: 'RECHARGE',
          amount: addUp,
          balanceAfter: updated.balance,
          pointsAfter: updated.points,
          note:
            dto.bonus && dto.bonus > 0
              ? `充值${dto.amount / 100}元赠${dto.bonus / 100}元${dto.note ? `，${dto.note}` : ''}`
              : (dto.note ?? null),
          operatorId: viewer.id,
        },
      });
      return updated;
    });
    await this.audit.log(viewer.id, 'member.recharge', id, {
      amount: dto.amount,
      bonus: dto.bonus ?? 0,
    });
    return result;
  }

  /** 人工调整（纠错用）：余额/积分增减，需填写原因 */
  async adjust(
    viewer: Viewer,
    id: string,
    dto: { balanceDelta?: number; pointsDelta?: number; note: string },
  ) {
    this.requireBoss(viewer);
    if (!dto.balanceDelta && !dto.pointsDelta) throw new BadRequestException('没有需要调整的项');
    const result = await this.prisma.$transaction(async (tx) => {
      const member = await tx.member.findUnique({ where: { id } });
      if (!member) throw new NotFoundException('会员不存在');
      const balanceDelta = dto.balanceDelta ?? 0;
      const pointsDelta = dto.pointsDelta ?? 0;
      if (member.balance + balanceDelta < 0) throw new BadRequestException('调整后余额不能为负');
      if (member.points + pointsDelta < 0) throw new BadRequestException('调整后积分不能为负');
      const updated = await tx.member.update({
        where: { id },
        data: {
          balance: { increment: balanceDelta },
          points: { increment: pointsDelta },
        },
      });
      await tx.memberTxn.create({
        data: {
          memberId: id,
          type: 'ADJUST',
          amount: balanceDelta,
          balanceAfter: updated.balance,
          pointsChange: pointsDelta,
          pointsAfter: updated.points,
          note: dto.note,
          operatorId: viewer.id,
        },
      });
      return updated;
    });
    await this.audit.log(viewer.id, 'member.adjust', id, dto as never);
    return result;
  }

  /** 会员流水（余额/积分变动全链路） */
  async txns(
    viewer: Viewer,
    id: string,
    q: { page?: string; pageSize?: string },
  ) {
    this.requireBoss(viewer);
    const page = Math.max(1, Number(q.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 30)));
    const [total, items] = await Promise.all([
      this.prisma.memberTxn.count({ where: { memberId: id } }),
      this.prisma.memberTxn.findMany({
        where: { memberId: id },
        include: { operator: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: items.map((t) => ({ ...t, operatorName: t.operator?.name ?? null })),
    };
  }
}
