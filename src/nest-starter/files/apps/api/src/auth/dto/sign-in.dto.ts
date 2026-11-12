import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SignInDto {
  @ApiProperty({ example: 'admin@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'change-me' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password: string;
}

export class SignInWithTokenDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  accessToken: string;
}
