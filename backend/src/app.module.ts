import { Controller, Get, Module, ServiceUnavailableException } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigurationModule } from './config.module';
import { DatabaseModule } from './database/database.module';
import { DatabaseService } from './database/database.service';
import { AuthService } from './auth/auth.service';
import { AuthGuard } from './auth/auth.guard';
import { AuthController } from './auth/auth.controller';
import { EventsService } from './iot/events.service';
import { IotRepository } from './iot/iot.repository';
import { MqttService } from './iot/mqtt.service';
import { IotService } from './iot/iot.service';
import { IotController } from './iot/iot.controller';

@Controller('health')
class HealthController {
  constructor(
    private readonly db: DatabaseService,
    private readonly mqtt: MqttService,
  ) {}
  @Get()
  async health() {
    try {
      await this.db.ping();
    } catch {
      throw new ServiceUnavailableException('Banco indisponível.');
    }
    return { status: 'ok', database: 'connected', mqtt: this.mqtt.connected ? 'connected' : 'disconnected' };
  }
}
@Module({
  imports: [ConfigurationModule, DatabaseModule, JwtModule.register({})],
  controllers: [AuthController, IotController, HealthController],
  providers: [AuthService, AuthGuard, EventsService, IotRepository, MqttService, IotService],
})
export class AppModule {}
