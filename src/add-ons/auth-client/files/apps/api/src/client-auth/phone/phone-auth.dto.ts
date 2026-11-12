import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';

export class SendPhoneCodeDto {
  @ApiProperty({ example: '+998901234567', description: 'International format; spaces, dashes and brackets are ignored' })
  @IsString()
  @MaxLength(32)
  phone: string;
}

export class VerifyPhoneCodeDto extends SendPhoneCodeDto {
  @ApiProperty({ example: '123456', description: 'The 6-digit code from the SMS' })
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;
}

export class PhoneCodeSentDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 180, description: 'Seconds the code stays valid' })
  expiresIn: number;

  @ApiProperty({ example: 60, description: 'Seconds before another code can be requested' })
  resendIn: number;
}
