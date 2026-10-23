import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';

// AuditService 由全局 PrismaModule 提供
@Module({
  providers: [CatalogService],
  controllers: [CatalogController],
})
export class CatalogModule {}
