import { csvEscape } from './export.controller';

/** csvEscape：CSV 转义 + Excel 公式注入防护 */
describe('csvEscape', () => {
  it('普通文本原样输出', () => {
    expect(csvEscape('晨光中性笔 K35')).toBe('晨光中性笔 K35');
  });

  it('含逗号引号换行时加引号并转义', () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });

  it('公式注入字符前缀单引号', () => {
    expect(csvEscape('=cmd|\' /C calc\'!A0')).toBe("'=cmd|' /C calc'!A0");
    expect(csvEscape('=HYPERLINK("http://evil")')).toBe('"\'=HYPERLINK(""http://evil"")"');
    expect(csvEscape('+1+1')).toBe("'+1+1");
    expect(csvEscape('@SUM(1)')).toBe("'@SUM(1)");
  });

  it('普通负数不受影响（保持数值单元格）', () => {
    expect(csvEscape(-5)).toBe('-5');
    expect(csvEscape('-3.50')).toBe('-3.50');
    expect(csvEscape(-350)).toBe('-350');
  });

  it('null/undefined 输出空串', () => {
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });
});
