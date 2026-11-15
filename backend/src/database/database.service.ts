import { Injectable, OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Injectable()
export class DatabaseService implements OnModuleInit {
  constructor(private readonly dataSource: DataSource) {}

  async onModuleInit() {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      // Serializa migrações entre inicializações simultâneas do backend.
      await runner.query('SELECT pg_advisory_lock($1)', [7142091]);
      await this.dataSource.runMigrations({ transaction: 'all' });
    } finally {
      try {
        await runner.query('SELECT pg_advisory_unlock($1)', [7142091]);
      } finally {
        await runner.release();
      }
    }
  }

  async ping() {
    await this.dataSource.query('SELECT 1');
  }
}
