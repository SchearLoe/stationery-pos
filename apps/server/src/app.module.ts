import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma.module';
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
})
export class AppModule {}
