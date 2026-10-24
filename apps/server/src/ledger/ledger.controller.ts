import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { LedgerService } from './ledger.service';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';

const EXPENSE_CATEGORIES = ['RESTOCK', 'RENT', 'UTILITIES', 'PAYROLL', 'FREIGHT', 'OTHER'] as const;

class ExpenseUpsertDto {
  @IsOptional()
  @IsISO8601()
  date?: string;

  @IsOptional()
  @IsIn(EXPENSE_CATEGORIES as unknown as string[])
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string | null;
}

class MonthlyQuery {
  @Matches(/^\d{4}-\d{2}$/, { message: '月份格式应为 YYYY-MM' })
  month!: string;
}

@Roles('BOSS')
@Controller('ledger')
export class LedgerController {
  constructor(private ledger: LedgerService) {}

  @Get('expenses')
  expenses(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Query()
    q: { month?: string; from?: string; to?: string; category?: string; page?: string; pageSize?: string },
  ) {
    return this.ledger.listExpenses(user, q);
  }

  @Get('monthly')
  monthly(@CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' }, @Query() q: MonthlyQuery) {
    return this.ledger.monthlyStatement(user, q.month);
  }

  @Post('expenses')
  createExpense(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Body() dto: ExpenseUpsertDto,
  ) {
    return this.ledger.createExpense(user, {
      date: dto.date ?? new Date().toISOString(),
      category: dto.category ?? 'OTHER',
      amount: dto.amount!,
      title: dto.title!,
      note: dto.note,
    });
  }

  @Put('expenses/:id')
  updateExpense(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Param('id') id: string,
    @Body() dto: ExpenseUpsertDto,
  ) {
    return this.ledger.updateExpense(user, id, dto);
  }

  @Delete('expenses/:id')
  deleteExpense(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Param('id') id: string,
  ) {
    return this.ledger.deleteExpense(user, id);
  }
}
