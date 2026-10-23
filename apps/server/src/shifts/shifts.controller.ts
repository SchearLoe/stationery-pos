import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { ShiftsService } from './shifts.service';
import { CurrentUser } from '../common/current-user.decorator';

class CloseShiftDto {
  @IsInt()
  countedCash!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  note?: string;
}

@Controller('shifts')
export class ShiftsController {
  constructor(private shifts: ShiftsService) {}

  @Get('current')
  current(@CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' }) {
    return this.shifts.current(user);
  }

  @Post('open')
  open(@CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' }) {
    return this.shifts.open(user);
  }

  @Post('close')
  close(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Body() dto: CloseShiftDto,
  ) {
    return this.shifts.close(user, dto);
  }

  @Get()
  list(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Query() q: { page?: string; pageSize?: string; mine?: string },
  ) {
    return this.shifts.list(user, q);
  }
}
