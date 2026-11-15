import { Global, Module } from '@nestjs/common';
import { CONFIG, readConfig } from './config';

@Global()
@Module({
  providers: [{ provide: CONFIG, useFactory: () => readConfig() }],
  exports: [CONFIG],
})
export class ConfigurationModule {}
