import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { SalesService } from './sales.service';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import {
  CreateRefundDto,
  CreateSaleOrderDto,
  ListOrdersQuery,
  VoidOrderDto,
} from './dto/sales.dto';

@Controller('sales')
export class SalesController {
  constructor(private sales: SalesService) {}

  @Post('orders')
  create(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Body() dto: CreateSaleOrderDto,
  ) {
    return this.sales.createSale(dto, user);
  }

  @Get('orders')
  list(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Query() q: ListOrdersQuery,
  ) {
    return this.sales.listOrders(user, q);
  }

  @Get('orders/:id')
  get(@CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' }, @Param('id') id: string) {
    return this.sales.getOrder(id, user);
  }

  @Get('orders/by-no/:orderNo')
  getByNo(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Param('orderNo') orderNo: string,
  ) {
    return this.sales.findByOrderNo(orderNo, user);
  }

  @Roles('BOSS')
  @Put('orders/:id/void')
  void(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Param('id') id: string,
    @Body() dto: VoidOrderDto,
  ) {
    return this.sales.voidOrder(id, dto.reason, user);
  }

  @Post('refunds')
  createRefund(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Body() dto: CreateRefundDto,
  ) {
    return this.sales.createRefund(dto, user);
  }

  @Get('refunds')
  listRefunds(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Query() q: { from?: string; to?: string; page?: string; pageSize?: string },
  ) {
    return this.sales.listRefunds(user, q);
  }

  @Get('refunds/:id')
  getRefund(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Param('id') id: string,
  ) {
    return this.sales.getRefund(id, user);
  }
}
