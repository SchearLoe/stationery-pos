import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ExportController } from './export.controller';

@Module({
  imports: [LedgerModule],
  controllers: [ReportsController, ExportController],
  providers: [ReportsService],
})
export class ReportsModule {}
