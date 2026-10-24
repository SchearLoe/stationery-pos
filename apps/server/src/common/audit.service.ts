import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** 审计日志：敏感操作统一记录，只写不改不删 */
@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  log(
    userId: string | undefined,
    action: string,
    target?: string,
    detail?: unknown,
  ) {
    return this.prisma.auditLog
      .create({
        data: {
          userId,
          action,
          target,
          detail: (detail ?? undefined) as never,
        },
      })
      .catch(() => undefined); // 审计失败不阻断业务
  }
}
