import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ReportsService } from './reports.service';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../common/prisma.service';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';

type Viewer = { id: string; role: 'BOSS' | 'CASHIER' };

/** 与共享包 PAYMENT_METHOD_LABELS 保持一致（服务端自持，避免跨包依赖） */
const PAYMENT_LABELS: Record<string, string> = {
  CASH: '现金',
  WECHAT: '微信',
  ALIPAY: '支付宝',
  CARD: '刷卡',
  OTHER: '其他',
  BALANCE: '储值余额',
};

export function csvEscape(v: unknown): string {
  let s = v === null || v === undefined ? '' : String(v);
  // 防 Excel 公式注入：以 = + - @ 等开头的文本单元格前置单引号（纯数字负数不受影响）
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) {
    s = `'${s}`;
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV（带 BOM，Excel 中文不乱码），金额统一输出为元（两位小数） */
function toCsv(header: string[], rows: unknown[][]): string {
  return '\uFEFF' + [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
}

const yuan = (fen: number) => (fen / 100).toFixed(2);
const dt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

@Controller('reports/export')
@Roles('BOSS')
export class ExportController {
  constructor(
    private reports: ReportsService,
    private ledger: LedgerService,
    private prisma: PrismaService,
  ) {}

  private send(res: Response, filename: string, csv: string) {
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="${filename}"`);
    return csv;
  }

  /** 销售汇总 */
  @Get('summary')
  async summary(
    @CurrentUser() user: Viewer,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const s = await this.reports.summary(user, new Date(from), new Date(to));
    const csv = toCsv(
      ['指标', '数值'],
      [
        ['订单数', s.orderCount],
        ['退货单数', s.refundCount],
        ['销售额（元）', yuan(s.salesAmount)],
        ['退款额（元）', yuan(s.refundAmount)],
        ['净销售额（元）', yuan(s.netAmount)],
        ...s.byMethod.map((m) => [`支付方式-${PAYMENT_LABELS[m.method] ?? m.method}（元）`, yuan(m.amount)]),
      ],
    );
    return this.send(res, `summary_${from}_${to}.csv`, csv);
  }

  /** 每日销售趋势 */
  @Get('daily')
  async daily(
    @CurrentUser() user: Viewer,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rows = await this.reports.dailySeries(user, new Date(from), new Date(to));
    const csv = toCsv(
      ['日期', '销售额（元）', '退款额（元）', '净销售额（元）', '订单数'],
      rows.map((r) => [r.date, yuan(r.sales), yuan(r.refunds), yuan(r.net), r.orders]),
    );
    return this.send(res, `daily_${from}_${to}.csv`, csv);
  }

  /** 商品销量排行 */
  @Get('top-products')
  async topProducts(
    @CurrentUser() user: Viewer,
    @Query('from') from: string,
    @Query('to') to: string,
    @Query('limit') limit: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rows = await this.reports.topProducts(user, new Date(from), new Date(to), Number(limit ?? 20));
    const csv = toCsv(
      ['排名', '商品', '规格', '销量', '销售额（元）'],
      rows.map((r, i) => [i + 1, r.productName, r.spec ?? '', r.qty, yuan(r.amount)]),
    );
    return this.send(res, `top_products_${from}_${to}.csv`, csv);
  }

  /** 销售明细（单行 = 订单） */
  @Get('orders')
  async orders(
    @CurrentUser() user: Viewer,
    @Query('from') from: string,
    @Query('to') to: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const where = {
      createdAt: {
        gte: from ? new Date(from) : undefined,
        lte: to ? new Date(to) : undefined,
      },
    };
    const orders = await this.prisma.saleOrder.findMany({
      where,
      include: {
        cashier: { select: { name: true } },
        member: { select: { name: true, code: true } },
        items: true,
        payments: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });
    const csv = toCsv(
      ['单号', '时间', '收银员', '会员', '状态', '商品明细', '支付方式', '合计（元）', '优惠（元）', '积分抵扣（元）', '实收（元）'],
      orders.map((o) => [
        o.orderNo,
        dt(o.createdAt),
        o.cashier.name,
        o.member ? `${o.member.name}(${o.member.code})` : '',
        o.status === 'NORMAL' ? '正常' : '已作废',
        o.items.map((i) => `${i.productName}${i.spec ? `(${i.spec})` : ''}×${i.qty}`).join('；'),
        o.payments
          .map((p) => `${PAYMENT_LABELS[p.method] ?? p.method}${yuan(p.amount)}`)
          .join('；'),
        yuan(o.totalAmount),
        yuan(o.discountAmount),
        yuan(o.pointsDiscount),
        o.status === 'NORMAL' ? yuan(o.payableAmount) : `0.00（作废：${o.voidReason ?? ''}）`,
      ]),
    );
    return this.send(res, `orders_${from || 'all'}_${to || 'all'}.csv`, csv);
  }

  /** 库存快照（含成本，仅老板） */
  @Get('inventory')
  async inventory(@CurrentUser() user: Viewer, @Res({ passthrough: true }) res: Response) {
    const skus = await this.prisma.sku.findMany({
      include: {
        product: { select: { name: true, unit: true } },
        barcodes: { select: { barcode: true }, orderBy: { createdAt: 'asc' } },
        inventory: { select: { qty: true } },
      },
      orderBy: [{ product: { name: 'asc' } }, { spec: 'asc' }],
      take: 20000,
    });
    const csv = toCsv(
      ['商品', '规格', '条码', '单位', '零售价（元）', '库存', '安全库存', '最近进价（元）', '加权成本（元）', '库存金额（元）'],
      skus.map((s) => {
        const qty = s.inventory?.qty ?? 0;
        return [
          s.product.name,
          s.spec ?? '',
          s.barcodes[0]?.barcode ?? '',
          s.product.unit,
          yuan(s.retailPrice),
          qty,
          s.safetyStock,
          s.lastCost === null ? '' : yuan(s.lastCost),
          s.costAvg === null ? '' : yuan(s.costAvg),
          qty > 0 ? yuan(qty * (s.costAvg ?? 0)) : '0.00',
        ];
      }),
    );
    return this.send(res, `inventory_${dt(new Date()).slice(0, 10)}.csv`, csv);
  }

  /** 月结报表 */
  @Get('monthly')
  async monthly(
    @CurrentUser() user: Viewer,
    @Query('month') month: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const s = await this.ledger.monthlyStatement(user, month);
    const csv = toCsv(
      ['指标', '数值'],
      [
        ['月份', s.month],
        ['订单数', s.orderCount],
        ['退货单数', s.refundCount],
        ['销售额（元）', yuan(s.salesAmount)],
        ['退款额（元）', yuan(s.refundAmount)],
        ['净销售额（元）', yuan(s.netSalesAmount)],
        ['销售成本（元）', yuan(s.cogsAmount)],
        ['毛利（元）', yuan(s.grossProfit)],
        ['本月采购入库（元）', yuan(s.purchaseReceivedAmount)],
        ['本月采购付款（元）', yuan(s.purchasePaidAmount)],
        ['杂项支出（元）', yuan(s.expenseTotal)],
        ...s.expensesByCategory.map((e) => [`支出-${e.category}（元）`, yuan(e.amount)]),
        ['会员充值（元）', yuan(s.memberRechargeAmount)],
        ['净利估算（元）', yuan(s.netProfitEstimate)],
      ],
    );
    return this.send(res, `monthly_${month}.csv`, csv);
  }
}
