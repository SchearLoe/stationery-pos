import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class CreateCategoryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  name!: string;

  @IsOptional()
  parentId?: string;

  @IsOptional()
  @IsInt()
  sort?: number;
}

export class UpdateCategoryDto extends CreateCategoryDto {}

export class SkuInputDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsOptional()
  @IsString()
  barcode?: string | null;

  @IsOptional()
  @IsString()
  spec?: string | null;

  /** 零售价（分） */
  @IsInt()
  @Min(0)
  retailPrice!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  memberPrice?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  minPrice?: number | null;

  /** 最近进价（分），仅老板录入 */
  @IsOptional()
  @IsInt()
  @Min(0)
  cost?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  safetyStock?: number;

  @IsOptional()
  @IsIn(['ON_SALE', 'OFF_SALE'])
  status?: 'ON_SALE' | 'OFF_SALE';

  /** 期初库存，仅新建 SKU 时生效 */
  @IsOptional()
  @IsInt()
  initQty?: number;
}

export class UpsertProductDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  brand?: string | null;

  @IsOptional()
  categoryId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  unit?: string;

  @IsOptional()
  @IsIn(['ON_SALE', 'OFF_SALE'])
  status?: 'ON_SALE' | 'OFF_SALE';

  @IsOptional()
  @IsString()
  @MaxLength(200)
  remark?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => SkuInputDto)
  skus!: SkuInputDto[];
}

/** CSV 导入行（前端解析为 UTF-8 文本后提交） */
export class ImportRowDto {
  @IsString()
  categoryName!: string;

  @IsString()
  productName!: string;

  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsString()
  spec?: string;

  @IsOptional()
  @IsString()
  barcode?: string;

  /** 元，字符串形式提交由服务端转分 */
  @IsOptional()
  @IsString()
  cost?: string;

  @IsString()
  retailPrice!: string;

  @IsOptional()
  @IsString()
  memberPrice?: string;

  @IsOptional()
  @IsString()
  qty?: string;

  @IsOptional()
  @IsString()
  safetyStock?: string;
}

export class ImportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows!: ImportRowDto[];

  @IsOptional()
  @IsBoolean()
  /** 缺少条码时自动生成店内码 */
  autoBarcode?: boolean;
}
