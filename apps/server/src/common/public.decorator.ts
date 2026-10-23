import { SetMetadata } from '@nestjs/common';

/** 标记接口为公开访问（如登录），跳过 JWT 校验 */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
