import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';

@Controller('reports')
@Roles('BOSS')
export class ReportsController {
  constructor(private reports: ReportsService) {}

  @Get('summary')
  summary(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.reports.summary(user, new Date(from), new Date(to));
  }

  @Get('top-products')
  topProducts(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('limit') limit?: string,
  ) {
    return this.reports.topProducts(user, new Date(from), new Date(to), Number(limit ?? 20));
  }

  @Get('daily')
  daily(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.reports.dailySeries(user, new Date(from), new Date(to));
  }

  @Get('stock-value')
  stockValue(@CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' }) {
    return this.reports.stockValue(user);
  }
}
