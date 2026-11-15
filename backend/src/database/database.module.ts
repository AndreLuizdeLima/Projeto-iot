import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CONFIG, Config } from '../config';
import { ConfigurationModule } from '../config.module';
import { databaseOptions, entities } from './data-source';
import { DatabaseService } from './database.service';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigurationModule],
      inject: [CONFIG],
      useFactory: (config: Config) => ({ ...databaseOptions(config), retryAttempts: 2 }),
    }),
    TypeOrmModule.forFeature(entities),
  ],
  providers: [DatabaseService],
  exports: [TypeOrmModule, DatabaseService],
})
export class DatabaseModule {}
