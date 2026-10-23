import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.module';

export interface StoreSettingsShape {
  storeName: string;
  storePhone: string;
  storeAddress: string;
  receiptFooter: string;
  /** 是否允许负库存销售（文具店常见“先卖后补录”，默认允许） */
  allowNegativeStock: boolean;
  /** 整单折扣下限百分比（95 = 最低 95 折），收银员受此限制 */
  cashierMinDiscountPercent: number;
  cashierCanRefund: boolean;
}

export const DEFAULT_SETTINGS: StoreSettingsShape = {
  storeName: '我的文具店',
  storePhone: '',
  storeAddress: '',
  receiptFooter: '谢谢惠顾，欢迎再次光临',
  allowNegativeStock: true,
  cashierMinDiscountPercent: 95,
  cashierCanRefund: true,
};

@Injectable()
export class SettingService {
  constructor(private prisma: PrismaService) {}

  async get(): Promise<StoreSettingsShape> {
    const rows = await this.prisma.setting.findMany();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return { ...DEFAULT_SETTINGS, ...(map as Partial<StoreSettingsShape>) };
  }

  async update(patch: Partial<StoreSettingsShape>): Promise<StoreSettingsShape> {
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      await this.prisma.setting.upsert({
        where: { key },
        update: { value: value as never },
        create: { key, value: value as never },
      });
    }
    return this.get();
  }
}
