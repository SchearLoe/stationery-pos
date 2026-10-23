import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BrowserWindow, WebContents } from 'electron';

export interface PrinterInfo {
  name: string;
  displayName?: string;
  isDefault?: boolean;
  status?: number;
}

export async function listPrinters(wc: WebContents): Promise<PrinterInfo[]> {
  const printers = await wc.getPrintersAsync();
  return printers.map((p) => ({
    name: p.name,
    displayName: p.displayName,
    isDefault: p.isDefault,
    status: p.status,
  }));
}

/**
 * 通过 Windows 打印驱动打印 HTML 小票。
 * silent=true 时静默输出到指定（或默认）打印机；silent=false 弹出系统打印对话框。
 */
export async function printHtml(opts: {
  html: string;
  deviceName?: string;
  silent: boolean;
}): Promise<void> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(opts.html)}`);
    await new Promise<void>((resolve, reject) => {
      win.webContents.print(
        {
          silent: opts.silent,
          deviceName: opts.deviceName || undefined,
          margins: { marginType: 'none' },
          printBackground: true,
        },
        (success, failureReason) => {
          if (success) resolve();
          else reject(new Error(`打印失败：${failureReason ?? '未知原因'}`));
        },
      );
    });
  } finally {
    win.destroy();
  }
}

/**
 * ESC/POS 直连：把指令字节送入 Windows 打印后台（winspool，数据类型 RAW），
 * 使用打印机自带字库输出，不经过驱动排版。通过 PowerShell P/Invoke 调用 winspool，
 * 免编译原生模块。仅支持 Windows。
 */
export async function printEscposDirect(opts: { base64: string; printerName: string }): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('ESC/POS 直连打印目前仅支持 Windows');
  }
  if (!opts.printerName) {
    throw new Error('未配置直连打印机名称');
  }
  const bytes = Buffer.from(opts.base64, 'base64');
  const file = path.join(tmpdir(), `pos-receipt-${randomUUID()}.bin`);
  writeFileSync(file, bytes);

  // 打印机名/文件路径通过环境变量传入，避免命令行注入
  const script = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -TypeDefinition @'",
    'using System;',
    'using System.Runtime.InteropServices;',
    'public class RawSpool {',
    '  [DllImport("winspool.Drv", CharSet=CharSet.Unicode, SetLastError=true)]',
    '  public static extern bool OpenPrinter(string src, out IntPtr h, IntPtr def);',
    '  [DllImport("winspool.Drv", SetLastError=true)]',
    '  public static extern bool ClosePrinter(IntPtr h);',
    '  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]',
    '  public struct DOCINFO1 { public string pDocName; public string pOutputFile; public string pDatatype; }',
    '  [DllImport("winspool.Drv", CharSet=CharSet.Unicode, SetLastError=true)]',
    '  public static extern bool StartDocPrinter(IntPtr h, int level, ref DOCINFO1 di);',
    '  [DllImport("winspool.Drv", SetLastError=true)]',
    '  public static extern bool EndDocPrinter(IntPtr h);',
    '  [DllImport("winspool.Drv", SetLastError=true)]',
    '  public static extern bool StartPagePrinter(IntPtr h);',
    '  [DllImport("winspool.Drv", SetLastError=true)]',
    '  public static extern bool EndPagePrinter(IntPtr h);',
    '  [DllImport("winspool.Drv", SetLastError=true)]',
    '  public static extern bool WritePrinter(IntPtr h, IntPtr pBytes, int dwCount, out int dwWritten);',
    '  public static bool SendBytes(string printer, byte[] bytes) {',
    '    IntPtr h;',
    '    if (!OpenPrinter(printer, out h, IntPtr.Zero)) throw new Exception("无法打开打印机 (Win32 " + Marshal.GetLastWin32Error() + ")");',
    '    try {',
    '      var di = new DOCINFO1 { pDocName = "POS Receipt", pDatatype = "RAW" };',
    '      if (!StartDocPrinter(h, 1, ref di)) throw new Exception("StartDocPrinter 失败");',
    '      if (!StartPagePrinter(h)) throw new Exception("StartPagePrinter 失败");',
    '      int written;',
    '      IntPtr ptr = Marshal.AllocHGlobal(bytes.Length);',
    '      Marshal.Copy(bytes, 0, ptr, bytes.Length);',
    '      try {',
    '        if (!WritePrinter(h, ptr, bytes.Length, out written)) throw new Exception("WritePrinter 失败");',
    '      } finally { Marshal.FreeHGlobal(ptr); }',
    '      EndPagePrinter(h);',
    '      EndDocPrinter(h);',
    '      return true;',
    '    } finally { ClosePrinter(h); }',
    '  }',
    '}',
    "'@",
    '$bytes = [IO.File]::ReadAllBytes($env:POS_PRINT_FILE)',
    '[RawSpool]::SendBytes($env:POS_PRINTER, $bytes) | Out-Null',
    "Write-Output 'PRINT_OK'",
  ].join('\n');

  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      {
        env: { ...process.env, POS_PRINT_FILE: file, POS_PRINTER: opts.printerName },
        timeout: 20000,
        windowsHide: true,
      },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => reject(new Error(`无法启动打印进程：${e.message}`)));
    child.on('close', (code) => {
      if (out.includes('PRINT_OK')) resolve();
      else {
        const detail = (err || out || `退出码 ${code}`).trim().split('\n').slice(-3).join(' ');
        reject(new Error(`ESC/POS 直连失败：${detail}`));
      }
    });
  });
}
