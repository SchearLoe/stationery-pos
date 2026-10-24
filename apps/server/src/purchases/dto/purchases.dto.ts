import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class SupplierUpsertDto {
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  contact?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  remark?: string | null;
}

export class PurchaseItemInputDto {
  @IsUUID()
  skuId!: string;

  @IsInt()
  @Min(1)
  qty!: number;

  /** 进货单价（分） */
  @IsInt()
  @Min(0)
  unitCost!: number;
}

export class CreatePurchaseDto {
  @IsUUID()
  supplierId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemInputDto)
  items!: PurchaseItemInputDto[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  remark?: string | null;
}

export class PurchasePaymentDto {
  @IsInt()
  @Min(1)
  amount!: number;

  @IsOptional()
  @IsIn(['CASH', 'WECHAT', 'ALIPAY', 'CARD', 'OTHER'])
  method?: 'CASH' | 'WECHAT' | 'ALIPAY' | 'CARD' | 'OTHER';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  note?: string | null;
}

export class ListPurchasesQuery {
  @IsOptional()
  @IsIn(['DRAFT', 'RECEIVED', 'CANCELLED'])
  status?: 'DRAFT' | 'RECEIVED' | 'CANCELLED';

  @IsOptional()
  @IsUUID()
  supplierId?: string;

  @IsOptional()
  @IsString()
  keyword?: string;

  @IsOptional()
  @IsString()
  page?: string;

  @IsOptional()
  @IsString()
  pageSize?: string;
}
