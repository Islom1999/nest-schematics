import { Module } from '@nestjs/common';
import { MediaModule } from '@app/common/media';
import { TusAuthService } from './tus-auth.service';
import { TusUploadsController } from './tus-uploads.controller';
import { TusUploadsService } from './tus-uploads.service';

/**
 * Resumable uploads (tus), `npm run g -- upload-tus`. The engine adds its
 * parts here: `--engine node` the in-process tus server at `/api/files/tus`
 * (TusNodeController, TusNodeServer); `--engine tusd` the hook endpoint
 * `/api/internal/tus-hooks` (TusHooksController, TusHooksService). With
 * `auth-client`, a re-run adds the user token verifier (TUS_USER_AUTH).
 */
@Module({
  imports: [MediaModule],
  controllers: [TusUploadsController],
  providers: [TusAuthService, TusUploadsService],
})
export class TusModule {}
