import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { InventoryService } from './inventory.service';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';

class AdjustInventoryDto {
  @IsString()
  skuId!: string;

  @IsInt()
  @Min(0)
  actualQty!: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  note?: string;
}

@Controller('inventory')
export class InventoryController {
  constructor(private inventory: InventoryService) {}

  @Get()
  list(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Query()
    q: { keyword?: string; categoryId?: string; lowStock?: string; page?: string; pageSize?: string },
  ) {
    return this.inventory.list(user, q);
  }

  @Get('logs')
  logs(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Query()
    q: { skuId?: string; type?: string; from?: string; to?: string; page?: string; pageSize?: string },
  ) {
    return this.inventory.logs(user, q);
  }

  @Roles('BOSS')
  @Post('adjust')
  adjust(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Body() dto: AdjustInventoryDto,
  ) {
    return this.inventory.adjust(user, dto);
  }
}
