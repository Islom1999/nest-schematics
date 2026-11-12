import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiOkResponse, ApiProperty } from '@nestjs/swagger';
import { PaginatedResult } from '../dto/table-query.dto';

const pageClasses = new Map<Type<unknown>, Type<PaginatedResult<unknown>>>();

/**
 * Named page schema for a model: `Paginated<Model>` = `{ count, data: Model[] }`
 * (Angular `IPagination<T>`). One class per model, so every endpoint that
 * returns pages of `Product` shares one `PaginatedProduct` schema and the
 * generated client gets one `PaginatedProduct` type.
 */
export function PaginatedDto<T>(model: Type<T>): Type<PaginatedResult<T>> {
  let page = pageClasses.get(model);
  if (!page) {
    class Paginated implements PaginatedResult<T> {
      @ApiProperty({ type: Number, example: 1, description: 'Rows matching the filters (all pages)' })
      count: number;

      @ApiProperty({ type: () => model, isArray: true })
      data: T[];
    }
    Object.defineProperty(Paginated, 'name', { value: `Paginated${model.name}` });
    page = Paginated as Type<PaginatedResult<unknown>>;
    pageClasses.set(model, page);
  }
  return page as Type<PaginatedResult<T>>;
}

/**
 * 200 response with `{ count, data: Model[] }`:
 *
 *   @Post('pagination')
 *   @ApiPaginatedResponse(Product)
 *   findAllPagination(@Body() query: TableQueryDto) { ... }
 */
export function ApiPaginatedResponse<T>(model: Type<T>, description = 'One page of rows') {
  const page = PaginatedDto(model);
  return applyDecorators(ApiExtraModels(model, page), ApiOkResponse({ type: page, description }));
}
