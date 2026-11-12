import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';

function messages(error: ValidationError): string[] {
  if (error.children?.length) return error.children.flatMap(messages);
  return Object.values(error.constraints ?? {});
}

/**
 * Same rules as the global ValidationPipe (whitelist, forbidNonWhitelisted,
 * transform) for bodies whose class is only known at runtime (generic base
 * controller). Throws the same 400 shape.
 */
export async function validateDto<T extends object>(cls: new () => T, body: unknown): Promise<T> {
  const instance = plainToInstance(cls, body ?? {});
  const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) {
    throw new BadRequestException(errors.flatMap(messages));
  }
  return instance;
}
