import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma.module';
import { JwtAuthGuard, RolesGuard } from './common/guards';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CatalogModule } from './catalog/catalog.module';
import { SalesModule } from './sales/sales.module';
import { ShiftsModule } from './shifts/shifts.module';
import { InventoryModule } from './inventory/inventory.module';
import { ReportsModule } from './reports/reports.module';
import { SettingsModule } from './settings/settings.module';
import { PurchasesModule } from './purchases/purchases.module';
import { StocktakeModule } from './stocktake/stocktake.module';
import { MembersModule } from './members/members.module';
import { LedgerModule } from './ledger/ledger.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    UsersModule,
    CatalogModule,
    SalesModule,
    ShiftsModule,
    InventoryModule,
    ReportsModule,
    SettingsModule,
    PurchasesModule,
    StocktakeModule,
    MembersModule,
    LedgerModule,
  ],
  // 全局 JWT 鉴权 + 角色守卫：@Public() 跳过鉴权，@Roles() 控制角色
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
