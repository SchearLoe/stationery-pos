import { Module } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

// AuditService 由全局 PrismaModule 提供
@Module({
  providers: [UsersService],
  controllers: [UsersController],
})
export class UsersModule {}
