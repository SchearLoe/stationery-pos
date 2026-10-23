import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import {
  CreateCategoryDto,
  ImportDto,
  UpdateCategoryDto,
  UpsertProductDto,
} from './dto/catalog.dto';

@Controller()
export class CatalogController {
  constructor(private catalog: CatalogService) {}

  // 分类
  @Get('categories')
  listCategories() {
    return this.catalog.listCategories();
  }

  @Roles('BOSS')
  @Post('categories')
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.catalog.createCategory(dto);
  }

  @Roles('BOSS')
  @Put('categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.catalog.updateCategory(id, dto);
  }

  @Roles('BOSS')
  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string) {
    return this.catalog.deleteCategory(id);
  }

  // 商品
  @Get('products')
  listProducts(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Query()
    q: { keyword?: string; categoryId?: string; status?: string; page?: string; pageSize?: string },
  ) {
    return this.catalog.listProducts(user, q);
  }

  @Get('products/barcode/:barcode')
  findByBarcode(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Param('barcode') barcode: string,
  ) {
    return this.catalog.findByBarcode(barcode, user);
  }

  @Roles('BOSS')
  @Post('products')
  createProduct(@CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' }, @Body() dto: UpsertProductDto) {
    return this.catalog.upsertProduct(dto, user);
  }

  @Roles('BOSS')
  @Put('products/:id')
  updateProduct(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Param('id') id: string,
    @Body() dto: UpsertProductDto,
  ) {
    return this.catalog.upsertProduct({ ...dto, id }, user);
  }

  @Roles('BOSS')
  @Post('products/import')
  import(@CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' }, @Body() dto: ImportDto) {
    return this.catalog.importRows(dto, user);
  }
}
