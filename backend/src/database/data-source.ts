import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import { Config } from '../config';
import { UserEntity } from './entities/user.entity';
import { MqttMessageEntity } from './entities/mqtt-message.entity';
import { DeviceStateEntity } from './entities/device-state.entity';
import { DeviceAvailabilityEntity } from './entities/device-availability.entity';
import { CommandEntity } from './entities/command.entity';
import { InitialSchema1794700800000 } from './migrations/1794700800000-initial-schema';

export const entities = [
  UserEntity,
  MqttMessageEntity,
  DeviceStateEntity,
  DeviceAvailabilityEntity,
  CommandEntity,
];

export function databaseOptions(config: Config): DataSourceOptions {
  return {
    type: 'postgres',
    host: config.POSTGRES_HOST,
    port: config.POSTGRES_PORT,
    database: config.POSTGRES_DB,
    username: config.POSTGRES_USER,
    password: config.POSTGRES_PASSWORD,
    entities,
    migrations: [InitialSchema1794700800000],
    migrationsTableName: 'typeorm_migrations',
    synchronize: false,
    migrationsRun: false,
    logging: false,
    extra: { max: 5, connectionTimeoutMillis: 5000, statement_timeout: 10000 },
  };
}

export function createDataSource(config: Config) {
  return new DataSource(databaseOptions(config));
}
