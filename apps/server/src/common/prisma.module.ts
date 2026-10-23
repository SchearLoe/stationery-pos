import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AuditService } from './audit.service';
import { SettingService } from './setting.service';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/**
 * 全局基础设施模块：Prisma + 审计 + 设置。
 * 各业务模块直接注入，无需重复声明 provider。
 */
@Global()
@Module({
  providers: [PrismaService, AuditService, SettingService],
  exports: [PrismaService, AuditService, SettingService],
})
export class PrismaModule {}
