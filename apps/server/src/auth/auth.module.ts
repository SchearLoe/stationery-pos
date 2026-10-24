import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
    // 密钥经 ConfigService 异步读取：装饰器求值早于 dotenv 加载 .env，
    // 直接 register(process.env...) 会拿到 undefined 导致签发/校验密钥不一致
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-secret',
        signOptions: { expiresIn: JWT_EXPIRES_SECONDS },
      }),
    }),
  ],
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [JwtModule],
})
export class AuthModule {}
