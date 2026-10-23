import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../common/prisma.module';
import { AuditService } from '../common/audit.service';
import { CreateUserDto, UpdateUserDto } from '../auth/dto/login.dto';

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  list() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async create(dto: CreateUserDto, operatorId: string) {
    const exists = await this.prisma.user.findUnique({ where: { username: dto.username } });
    if (exists) throw new BadRequestException('用户名已存在');
    const user = await this.prisma.user.create({
      data: {
        username: dto.username,
        passwordHash: await bcrypt.hash(dto.password, 10),
        name: dto.name ?? dto.username,
        role: dto.role ?? 'CASHIER',
      },
      select: { id: true, username: true, name: true, role: true, active: true },
    });
    await this.audit.log(operatorId, 'user.create', user.id, { username: user.username, role: user.role });
    return user;
  }

  async update(id: string, dto: UpdateUserDto, operator: { id: string; role: string }) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('用户不存在');
    if (
      user.role === 'BOSS' &&
      (dto.role === 'CASHIER' || dto.active === false) &&
      (await this.prisma.user.count({ where: { role: 'BOSS', active: true } })) <= 1
    ) {
      throw new ForbiddenException('至少保留一个启用状态的老板账号');
    }
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 10);
    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, username: true, name: true, role: true, active: true },
    });
    await this.audit.log(operator.id, 'user.update', id, {
      fields: Object.keys(data).filter((k) => k !== 'passwordHash'),
    });
    return updated;
  }
}
