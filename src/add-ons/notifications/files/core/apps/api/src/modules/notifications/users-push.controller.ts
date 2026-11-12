import { Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOkResponse, ApiOperation } from '@nestjs/swagger';
import { AdminAccess } from '@app/common';
import { AdminResource } from '../../auth';
import { PushDeviceDto } from './dto/notification.dto';
import { PushDevicesService } from './push-devices.service';

/**
 * `/api/admin/users/:id/push-devices`: a user's push devices for support
 * (`notification.read`). Lives with the notifications add-on, next to the
 * auth-client's `admin/users` routes (same path prefix, other routes).
 */
@AdminResource('users', { read: ['notification.read'] })
export class UsersPushController {
  constructor(private readonly service: PushDevicesService) {}

  @AdminAccess('read')
  @Get(':id/push-devices')
  @ApiOperation({ summary: 'Push devices of a user: platform, masked token, device and when it was last seen' })
  @ApiOkResponse({ type: PushDeviceDto, isArray: true })
  devices(@Param('id', ParseUUIDPipe) id: string): Promise<PushDeviceDto[]> {
    return this.service.list(id);
  }
}
