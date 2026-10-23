import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  username!: string;

  @IsString()
  password!: string;
}

export class ChangePasswordDto {
  @IsString()
  oldPassword!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(32)
  newPassword!: string;
}

export class CreateUserDto {
  @IsString()
  @MinLength(2)
  @MaxLength(20)
  username!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(32)
  password!: string;

  @IsString()
  @IsOptional()
  @MaxLength(20)
  name?: string;

  role?: 'BOSS' | 'CASHIER';
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  name?: string;

  @IsOptional()
  role?: 'BOSS' | 'CASHIER';

  @IsOptional()
  active?: boolean;

  /** 重置密码（老板操作） */
  @IsOptional()
  @IsString()
  @MinLength(6)
  @MaxLength(32)
  password?: string;
}
