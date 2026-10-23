import { SetMetadata } from '@nestjs/common';

export type Role = 'BOSS' | 'CASHIER';

export const ROLES_KEY = 'roles';
/** 标记接口允许的角色；未标记则任何登录用户可访问 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
