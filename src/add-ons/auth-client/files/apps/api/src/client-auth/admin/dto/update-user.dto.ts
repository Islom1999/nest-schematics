import { PartialType } from '@nestjs/swagger';
import { CreateUserDto } from './create-user.dto';

/** Body of `PATCH admin/users/:id`: every field of the create body, all optional (null clears phone/email). */
export class UpdateUserDto extends PartialType(CreateUserDto) {}
