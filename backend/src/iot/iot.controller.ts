import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { interval, map, merge, of, takeUntil, timer } from 'rxjs';
import { AuthGuard, AuthRequest } from '../auth/auth.guard';
import { EventsService } from './events.service';
import { IotService } from './iot.service';

@Controller()
@UseGuards(AuthGuard)
export class IotController {
  constructor(
    private readonly iot: IotService,
    private readonly events: EventsService,
  ) {}
  @Get('dispositivo')
  @Header('Cache-Control', 'no-store')
  dashboard() {
    return this.iot.dashboard();
  }
  @Post('dispositivos/:deviceId/encher')
  @HttpCode(202)
  fill(
    @Param('deviceId') deviceId: string,
    @Headers('idempotency-key') key: string | undefined,
    @Req() request: AuthRequest,
  ) {
    const parsed = z.uuid().safeParse(key);
    if (!parsed.success) throw new BadRequestException('Envie um UUID no cabeçalho Idempotency-Key.');
    return this.iot.fill(deviceId, request.auth.sub, parsed.data);
  }
  @Sse('eventos')
  @Header('X-Accel-Buffering', 'no')
  @Header('Cache-Control', 'no-cache, no-transform')
  stream(@Req() request: AuthRequest) {
    const expiresIn = Math.max(0, request.auth.exp * 1000 - Date.now());
    return merge(
      of({ type: 'conectado', data: {} }),
      this.events.updates,
      interval(15000).pipe(map(() => ({ type: 'heartbeat', data: {} }))),
    ).pipe(takeUntil(timer(expiresIn)));
  }
}
