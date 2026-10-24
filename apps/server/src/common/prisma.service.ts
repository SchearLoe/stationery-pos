import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * 独立文件承载 PrismaService，避免「prisma.module → audit.service → prisma.module」
 * 的循环依赖：循环加载时构造器元数据会取到 undefined，导致 Nest 无法启动。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
