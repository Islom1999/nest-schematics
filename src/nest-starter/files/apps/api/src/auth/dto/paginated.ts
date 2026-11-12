import { Type } from '@nestjs/common';
import { getSchemaPath } from '@nestjs/swagger';

/** Swagger schema of `{ count, data: T[] }` (PrimeNG lazy table response). */
export function paginatedSchema(entity: Type<unknown>) {
  return {
    type: 'object',
    required: ['count', 'data'],
    properties: {
      count: { type: 'number', example: 1 },
      data: { type: 'array', items: { $ref: getSchemaPath(entity) } },
    },
  };
}
