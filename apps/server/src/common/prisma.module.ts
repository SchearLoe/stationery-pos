import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AuditService } from './audit.service';
import { SettingService } from './setting.service';

/**
 * 全局基础设施模块：Prisma + 审计 + 设置。
 * 各业务模块直接注入，无需重复声明 provider。
 * 注意：业务代码应从 ./prisma.service 导入 PrismaService（勿从本文件导入，会形成循环依赖）。
 */
@Global()
@Module({
  providers: [PrismaService, AuditService, SettingService],
  exports: [PrismaService, AuditService, SettingService],
})
export class PrismaModule {}
