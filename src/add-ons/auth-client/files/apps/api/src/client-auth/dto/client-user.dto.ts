import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { User } from '@app/database';

/**
 * The signed-in user as the client app sees it (`user` of sign-in responses
 * and `GET client/auth/me`). Sign-in methods add their fields at the markers.
 */
export class ClientUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ type: String, example: '100000', description: 'Account number for payments' })
  accountNo: string;

  @ApiProperty({ example: 'Ali Valiyev' })
  name: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'uz' })
  language: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;
  // @ns:client-user-fields
}

export function toClientUser(user: User): ClientUserDto {
  return {
    id: user.id,
    accountNo: user.accountNo,
    name: user.name,
    language: user.language,
    createdAt: user.createdAt,
    // @ns:client-user-map
  };
}
