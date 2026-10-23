import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from '../common/jwt.strategy';

/** JWT 有效期（秒），默认 12 小时；仅接受数字配置 */
const JWT_EXPIRES_SECONDS = Number(process.env.JWT_EXPIRES) > 0 ? Number(process.env.JWT_EXPIRES) : 43200;

@Module({
  imports: [
    PassportModule,
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'dev-secret',
      signOptions: { expiresIn: JWT_EXPIRES_SECONDS },
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [JwtModule],
})
export class AuthModule {}
