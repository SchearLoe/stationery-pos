import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class SaleItemInputDto {
  @IsUUID()
  skuId!: string;

  @IsInt()
  @Min(1)
  qty!: number;

  /** 成交单价（分），与零售价不同即为改价 */
  @IsInt()
  @Min(0)
  unitPrice!: number;
}

export class PaymentInputDto {
  @IsIn(['CASH', 'WECHAT', 'ALIPAY', 'CARD', 'OTHER'])
  method!: 'CASH' | 'WECHAT' | 'ALIPAY' | 'CARD' | 'OTHER';

  @IsInt()
  @Min(0)
  amount!: number;
}

export class CreateSaleOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SaleItemInputDto)
  items!: SaleItemInputDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PaymentInputDto)
  payments!: PaymentInputDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  remark?: string | null;

  @IsOptional()
  @IsString()
  clientId?: string;

  @IsOptional()
  @IsISO8601()
  offlineCreatedAt?: string;
}

export class RefundItemInputDto {
  @IsUUID()
  saleItemId!: string;

  @IsInt()
  @Min(1)
  qty!: number;
}

export class CreateRefundDto {
  @IsUUID()
  orderId!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  reason!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RefundItemInputDto)
  items!: RefundItemInputDto[];

  @IsOptional()
  @IsIn(['CASH', 'WECHAT', 'ALIPAY', 'CARD', 'OTHER'])
  method?: 'CASH' | 'WECHAT' | 'ALIPAY' | 'CARD' | 'OTHER';
}

export class VoidOrderDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  reason!: string;
}

/** 收银员改价上限保护：单件改价不得超过原价 10 倍等极端值校验放在服务逻辑 */
export class ListOrdersQuery {
  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @IsIn(['NORMAL', 'VOID'])
  status?: 'NORMAL' | 'VOID';

  @IsOptional()
  @IsString()
  cashierId?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}
