import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface CurrentUser {
  id: string;
  username: string;
  name: string;
  role: 'BOSS' | 'CASHIER';
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUser => ctx.switchToHttp().getRequest().user,
);
