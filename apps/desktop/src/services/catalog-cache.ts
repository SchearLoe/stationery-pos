/**
 * 商品目录本地缓存（IndexedDB）：离线收银的扫码与查价数据源。
 * 在线时以服务端为准定期刷新；离线销售时在缓存上预扣减库存（同步后以服务端为准）。
 */
import { get, set } from 'idb-keyval';
import type { CategoryDto, ProductDto } from '@pos/shared-types';
import { listCategories, listProducts } from '@/api';

const KEY = 'pos_catalog_v1';
/** 缓存有效期：5 分钟 */
const FRESH_MS = 5 * 60 * 1000;

export interface CatalogCache {
  products: ProductDto[];
  categories: CategoryDto[];
  cachedAt: number;
}

export async function getCachedCatalog(): Promise<CatalogCache | null> {
  return (await get<CatalogCache>(KEY)) ?? null;
}

/** 拉取全量在售商品刷新缓存；失败时静默保留旧缓存（离线启动场景） */
export async function refreshCatalogCache(force = false): Promise<CatalogCache | null> {
  const current = await getCachedCatalog();
  if (!force && current && Date.now() - current.cachedAt < FRESH_MS) return current;
  try {
    const categories = await listCategories();
    const products: ProductDto[] = [];
    let page = 1;
    for (;;) {
      const result = await listProducts({ page, pageSize: 100, status: 'ON_SALE' });
      products.push(...result.items);
      if (products.length >= result.total || result.items.length === 0) break;
      page++;
    }
    const cache: CatalogCache = { products, categories, cachedAt: Date.now() };
    await set(KEY, cache);
    return cache;
  } catch {
    return current; // 网络不可用：沿用旧缓存
  }
}

export interface BarcodeHit {
  sku: ProductDto['skus'][number];
  productName: string;
  unit: string;
  productStatus: string;
}

/** 与线上 API 相同返回形状的本地查价（离线用） */
export async function cachedFindByBarcode(barcode: string): Promise<BarcodeHit | null> {
  const cache = await getCachedCatalog();
  if (!cache) return null;
  for (const p of cache.products) {
    for (const sku of p.skus) {
      if (sku.barcodes?.includes(barcode) || sku.barcode === barcode) {
        return { sku, productName: p.name, unit: p.unit, productStatus: p.status };
      }
    }
  }
  return null;
}

export async function cachedSearch(keyword: string): Promise<ProductDto[]> {
  const cache = await getCachedCatalog();
  if (!cache) return [];
  const kw = keyword.trim().toLowerCase();
  return cache.products.filter(
    (p) =>
      p.name.toLowerCase().includes(kw) ||
      (p.brand ?? '').toLowerCase().includes(kw) ||
      p.skus.some((s) => s.barcode === kw || s.barcodes?.includes(kw)),
  );
}

/** 离线成交后在缓存上预扣库存（仅影响本地显示，云端以流水为准） */
export async function applySaleToCache(sold: { skuId: string; qty: number }[]): Promise<void> {
  const cache = await getCachedCatalog();
  if (!cache) return;
  const soldMap = new Map(sold.map((s) => [s.skuId, s.qty]));
  for (const p of cache.products) {
    for (const sku of p.skus) {
      const soldQty = soldMap.get(sku.id);
      if (soldQty && sku.qty !== undefined) {
        sku.qty = sku.qty - soldQty;
      }
    }
  }
  await set(KEY, cache);
}
