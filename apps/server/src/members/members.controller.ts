import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MembersService } from './members.service';
import { CurrentUser } from '../common/current-user.decorator';
import { Roles } from '../common/roles.decorator';

class MemberUpsertDto {
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  remark?: string | null;
}

class MemberUpdateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(30)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  remark?: string | null;

  @IsOptional()
  @IsIn(['true', 'false'])
  active?: string;
}

class RechargeDto {
  /** 充值本金（分） */
  @IsInt()
  @Min(1)
  amount!: number;

  /** 赠送金额（分） */
  @IsOptional()
  @IsInt()
  @Min(0)
  bonus?: number;

  @IsOptional()
  @IsIn(['CASH', 'WECHAT', 'ALIPAY', 'CARD', 'OTHER'])
  method?: 'CASH' | 'WECHAT' | 'ALIPAY' | 'CARD' | 'OTHER';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  note?: string;
}

class AdjustMemberDto {
  @IsOptional()
  @IsInt()
  balanceDelta?: number;

  @IsOptional()
  @IsInt()
  pointsDelta?: number;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  note!: string;
}

@Controller('members')
export class MembersController {
  constructor(private members: MembersService) {}

  /** 查询会员：收银员也可（收银台挂会员） */
  @Get()
  list(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Query() q: { keyword?: string; page?: string; pageSize?: string },
  ) {
    return this.members.list(user, q);
  }

  @Get('lookup')
  lookup(@CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' }, @Query('key') key: string) {
    return this.members.findByCodeOrPhone(user, key);
  }

  @Roles('BOSS')
  @Post()
  create(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Body() dto: MemberUpsertDto,
  ) {
    return this.members.create(user, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' }, @Param('id') id: string) {
    return this.members.get(user, id);
  }

  @Roles('BOSS')
  @Put(':id')
  update(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Param('id') id: string,
    @Body() dto: MemberUpdateDto,
  ) {
    const { active, ...rest } = dto;
    const data = {
      ...rest,
      ...(active !== undefined ? { active: active === 'true' } : {}),
    };
    return this.members.update(user, id, data);
  }

  @Roles('BOSS')
  @Post(':id/recharge')
  recharge(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Param('id') id: string,
    @Body() dto: RechargeDto,
  ) {
    return this.members.recharge(user, id, dto);
  }

  @Roles('BOSS')
  @Post(':id/adjust')
  adjust(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Param('id') id: string,
    @Body() dto: AdjustMemberDto,
  ) {
    return this.members.adjust(user, id, dto);
  }

  @Roles('BOSS')
  @Get(':id/txns')
  txns(
    @CurrentUser() user: { id: string; role: 'BOSS' | 'CASHIER' },
    @Param('id') id: string,
    @Query() q: { page?: string; pageSize?: string },
  ) {
    return this.members.txns(user, id, q);
  }
}
