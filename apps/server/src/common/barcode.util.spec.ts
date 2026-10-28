import { checkDigit, genMemberCode, genOrderNo, genStoreBarcode, validateBarcode } from './barcode.util';

describe('barcode.util', () => {
  it('checkDigit 计算 EAN-13 校验位（690123456789 -> 2）', () => {
    expect(checkDigit('690123456789')).toBe('2');
  });

  it('genStoreBarcode 生成合法店内码（2 前缀 12 位，能通过校验）', () => {
    const code = genStoreBarcode();
    expect(code).toMatch(/^2\d{11}$/);
    expect(() => validateBarcode(code)).not.toThrow();
  });

  it('validateBarcode 接受校验位正确的标准条码', () => {
    expect(() => validateBarcode('6901234567892')).not.toThrow();
  });

  it('validateBarcode 拒绝校验位错误的外部条码', () => {
    expect(() => validateBarcode('6901234567890')).toThrow(/校验位/);
  });

  it('validateBarcode 拒绝非 6~20 位数字', () => {
    expect(() => validateBarcode('abc')).toThrow();
    expect(() => validateBarcode('12345')).toThrow();
    expect(() => validateBarcode('123456789012345678901')).toThrow();
  });

  it('genOrderNo 生成各前缀单号（前缀+8位日期+4位随机）', () => {
    expect(genOrderNo('S')).toMatch(/^S\d{8}-[0-9A-F]{4}$/);
    expect(genOrderNo('R')).toMatch(/^R\d{8}-[0-9A-F]{4}$/);
    expect(genOrderNo('P')).toMatch(/^P\d{8}-[0-9A-F]{4}$/);
    expect(genOrderNo('T')).toMatch(/^T\d{8}-[0-9A-F]{4}$/);
  });

  it('genMemberCode 生成 M+8 位防猜字母数字会员码（不含易混字符）', () => {
    const code = genMemberCode();
    expect(code).toMatch(/^M[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/);
    // 连续生成不重复（防撞靠随机空间 + 唯一约束兜底）
    expect(genMemberCode()).not.toBe(code);
  });
});
