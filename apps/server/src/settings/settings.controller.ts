import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import { SettingService } from '../common/setting.service';
import { Roles } from '../common/roles.decorator';
import { AuditService } from '../common/audit.service';
import { CurrentUser } from '../common/current-user.decorator';
import { PrismaService } from '../common/prisma.service';

class UpdateSettingsDto {
  storeName?: string;
  storePhone?: string;
  storeAddress?: string;
  receiptFooter?: string;
  allowNegativeStock?: boolean;
  cashierMinDiscountPercent?: number;
  cashierCanRefund?: boolean;
}

@Controller('settings')
export class SettingsController {
  constructor(
    private settings: SettingService,
    private audit: AuditService,
    private prisma: PrismaService,
  ) {}

  /** 设置读取对所有角色开放（小票页头、折扣上限等收银台也要用），更新仅老板 */
  @Get()
  get() {
    return this.settings.get();
  }

  @Roles('BOSS')
  @Put()
  async update(@CurrentUser() user: { id: string }, @Body() dto: UpdateSettingsDto) {
    const result = await this.settings.update(dto);
    await this.audit.log(user.id, 'settings.update', undefined, dto as never);
    return result;
  }

  /** 审计日志：只可查不可删 */
  @Roles('BOSS')
  @Get('audit-logs')
  auditLogs(
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
    @Query('action') action?: string,
  ) {
    const p = Math.max(1, Number(page));
    const size = Math.min(200, Math.max(1, Number(pageSize)));
    return this.prisma.$transaction(async (tx) => {
      const where = action ? { action: { contains: action } } : {};
      const [total, items] = await Promise.all([
        tx.auditLog.count({ where }),
        tx.auditLog.findMany({
          where,
          include: { user: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          skip: (p - 1) * size,
          take: size,
        }),
      ]);
      return { total, page: p, pageSize: size, items };
    });
  }
}
