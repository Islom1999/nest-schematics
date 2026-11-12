import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller()
export class ApiController {
  @Get()
  health() {
    return { status: 'ok', time: new Date().toISOString() };
  }
}
