import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { IsArray, IsInt, IsIn, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { StocktakeService } from './stocktake.service';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';

class CreateStocktakeDto {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  note?: string;
}

class StocktakeCountDto {
  @IsUUID()
  id!: string;

  /** 实盘数量；null 表示清空/跳过该项 */
  @IsOptional()
  @IsInt()
  @Min(0)
  countedQty!: number | null;
}

class SaveCountsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => StocktakeCountDto)
  items!: StocktakeCountDto[];
}

@Roles('BOSS')
@Controller('stocktakes')
export class StocktakeController {
  constructor(private stocktake: StocktakeService) {}

  @Get()
  list(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Query() q: { status?: string; page?: string; pageSize?: string },
  ) {
    return this.stocktake.list(user, q);
  }

  @Get(':id')
  get(@CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' }, @Param('id') id: string) {
    return this.stocktake.getTask(user, id);
  }

  @Post()
  create(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Body() dto: CreateStocktakeDto,
  ) {
    return this.stocktake.create(user, dto);
  }

  @Put(':id/counts')
  saveCounts(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Param('id') id: string,
    @Body() dto: SaveCountsDto,
  ) {
    return this.stocktake.saveCounts(user, id, dto);
  }

  @Post(':id/apply')
  apply(@CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' }, @Param('id') id: string) {
    return this.stocktake.apply(user, id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' }, @Param('id') id: string) {
    return this.stocktake.cancel(user, id);
  }
}
