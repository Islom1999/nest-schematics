import { Body, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, Type } from '@nestjs/common';
import { ApiBody, ApiExtraModels, ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AdminAccess } from '../decorators/admin-access.decorator';
import { DeleteResultDto, OptionDto, OptionsQueryDto, TableQueryDto } from '../dto/table-query.dto';
import { ApiPaginatedResponse } from '../swagger/paginated';
import { validateDto } from '../validation/validate-dto';
import { BaseCrudService } from './base-crud.service';
import { BaseEntity } from '@app/database';

export interface CrudControllerOptions<M extends BaseEntity, C extends object, U extends object> {
  entity: Type<M>;
  createDto: Type<C>;
  updateDto: Type<U>;
}

/**
 * Standard admin CRUD routes — exactly what the Angular `BaseCrudService`
 * (fuse-schematics) calls. A resource controller extends the returned class
 * and is decorated with `@AdminResource(path, permissions)`:
 *
 *   GET    /                    all rows (unpaged; ?column=value filters)
 *   POST   /pagination          PrimeNG lazy table → { count, data }
 *   POST   /pagination/archive  same, soft-deleted rows
 *   GET    /options             [{ id, label }] for relation selects (?search=&ids=&limit=&label=)
 *   GET    /archive/:id         one soft-deleted row
 *   GET    /:id                 one row
 *   POST   /                    create (validated against createDto)
 *   PUT    /:id                 update (validated against updateDto)
 *   DELETE /:id                 soft delete → archive
 *   GET    /repair/:id          restore from archive
 *
 * Extra routes go on the subclass. Give them two-segment paths
 * (`:id/status`, `stats/summary`) so they never collide with `GET :id`.
 */
export function BaseCrudController<M extends BaseEntity, C extends object, U extends object>(
  options: CrudControllerOptions<M, C, U>,
) {
  const { entity, createDto, updateDto } = options;

  @ApiExtraModels(entity)
  abstract class CrudController {
    constructor(protected readonly service: BaseCrudService<M, C, U>) {}

    @AdminAccess('read')
    @Get()
    @ApiOperation({ summary: 'All rows (unpaged)' })
    @ApiOkResponse({ type: entity, isArray: true })
    findAll(@Query() where: Record<string, string>) {
      return this.service.findAll(where);
    }

    @AdminAccess('read')
    @HttpCode(HttpStatus.OK)
    @Post('pagination')
    @ApiOperation({ summary: 'Paged rows (PrimeNG lazy table)' })
    @ApiPaginatedResponse(entity)
    findAllPagination(@Body() query: TableQueryDto) {
      return this.service.findAllPagination(query, true);
    }

    @AdminAccess('read')
    @HttpCode(HttpStatus.OK)
    @Post('pagination/archive')
    @ApiOperation({ summary: 'Paged soft-deleted rows' })
    @ApiPaginatedResponse(entity)
    findAllPaginationArchive(@Body() query: TableQueryDto) {
      return this.service.findAllPagination(query, false);
    }

    @AdminAccess('read')
    @Get('options')
    @ApiOperation({ summary: 'Id/label pairs for relation selects (?search=&ids=&limit=&label=)' })
    @ApiOkResponse({ type: OptionDto, isArray: true })
    options(@Query() query: OptionsQueryDto) {
      return this.service.options(query);
    }

    @AdminAccess('read')
    @Get('archive/:id')
    @ApiOperation({ summary: 'One soft-deleted row' })
    @ApiOkResponse({ type: entity })
    findOneArchive(@Param('id', ParseUUIDPipe) id: string) {
      return this.service.findOne(id, false);
    }

    @AdminAccess('write')
    @Get('repair/:id')
    @ApiOperation({ summary: 'Restore a soft-deleted row' })
    @ApiOkResponse({ type: entity })
    repair(@Param('id', ParseUUIDPipe) id: string) {
      return this.service.repair(id);
    }

    @AdminAccess('read')
    @Get(':id')
    @ApiOperation({ summary: 'One row' })
    @ApiOkResponse({ type: entity })
    findOne(@Param('id', ParseUUIDPipe) id: string) {
      return this.service.findOne(id, true);
    }

    @AdminAccess('write')
    @Post()
    @ApiOperation({ summary: 'Create' })
    @ApiBody({ type: createDto })
    @ApiOkResponse({ type: entity })
    async create(@Body() body: unknown) {
      return this.service.create(await validateDto(createDto, body));
    }

    @AdminAccess('write')
    @Put(':id')
    @ApiOperation({ summary: 'Update' })
    @ApiBody({ type: updateDto })
    @ApiOkResponse({ type: entity })
    async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
      return this.service.update(id, await validateDto(updateDto, body));
    }

    @AdminAccess('write')
    @Delete(':id')
    @ApiOperation({ summary: 'Soft delete (move to archive)' })
    @ApiOkResponse({ type: DeleteResultDto })
    delete(@Param('id', ParseUUIDPipe) id: string) {
      return this.service.delete(id);
    }
  }

  return CrudController;
}
