import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { PurchasesService } from './purchases.service';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';
import {
  CreatePurchaseDto,
  ListPurchasesQuery,
  PurchasePaymentDto,
  ReceivePurchaseDto,
  SupplierUpsertDto,
} from './dto/purchases.dto';

/** 采购/应付整体为老板域：收银员不可见 */
@Roles('BOSS')
@Controller('purchases')
export class PurchasesController {
  constructor(private purchases: PurchasesService) {}

  // ---------- 供应商 ----------

  @Get('suppliers')
  suppliers(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Query('keyword') keyword?: string,
  ) {
    return this.purchases.listSuppliers(user, keyword);
  }

  @Post('suppliers')
  createSupplier(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Body() dto: SupplierUpsertDto,
  ) {
    return this.purchases.createSupplier(user, dto);
  }

  @Put('suppliers/:id')
  updateSupplier(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Param('id') id: string,
    @Body() dto: SupplierUpsertDto,
  ) {
    return this.purchases.updateSupplier(user, id, dto);
  }

  @Delete('suppliers/:id')
  deleteSupplier(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Param('id') id: string,
  ) {
    return this.purchases.deleteSupplier(user, id);
  }

  // ---------- 应付汇总 ----------

  @Get('payables')
  payables(@CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' }) {
    return this.purchases.payables(user);
  }

  // ---------- 采购单 ----------

  @Get('orders')
  orders(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Query() q: ListPurchasesQuery,
  ) {
    return this.purchases.listOrders(user, q);
  }

  @Get('orders/:id')
  order(@CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' }, @Param('id') id: string) {
    return this.purchases.getOrder(user, id);
  }

  @Post('orders')
  create(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Body() dto: CreatePurchaseDto,
  ) {
    return this.purchases.createOrder(user, dto);
  }

  @Post('orders/:id/receive')
  receive(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Param('id') id: string,
    @Body() dto?: ReceivePurchaseDto,
  ) {
    return this.purchases.receive(user, id, dto);
  }

  @Post('orders/:id/cancel')
  cancel(@CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' }, @Param('id') id: string) {
    return this.purchases.cancel(user, id);
  }

  @Post('orders/:id/payments')
  pay(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Param('id') id: string,
    @Body() dto: PurchasePaymentDto,
  ) {
    return this.purchases.addPayment(user, id, dto);
  }
}
