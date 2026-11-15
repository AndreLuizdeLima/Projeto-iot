import { Injectable, MessageEvent } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Subject } from 'rxjs';

@Injectable()
export class EventsService {
  readonly updates = new Subject<MessageEvent>();
  notify(deviceId: string) {
    this.updates.next({ type: 'dispositivo.atualizado', id: randomUUID(), data: { deviceId } });
  }
}
