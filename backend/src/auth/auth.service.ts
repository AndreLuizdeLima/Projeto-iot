import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { CONFIG, Config } from '../config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UserEntity } from '../database/entities/user.entity';

export interface AuthClaims {
  sub: string;
  email: string;
  exp: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    private readonly jwt: JwtService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}
  async bootstrap(email: string, password: string, secret: string | undefined) {
    const expected = Buffer.from(this.config.BOOTSTRAP_SECRET);
    const actual = Buffer.from(secret ?? '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new UnauthorizedException('Credencial de inicialização inválida.');
    const passwordHash = await hash(password, 12);
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [7142092]);
      const users = manager.getRepository(UserEntity);
      if (await users.existsBy({})) throw new ConflictException('O usuário inicial já foi criado.');
      const user = await users.save(users.create({ id: randomUUID(), email, passwordHash }));
      return { id: user.id, email: user.email };
    });
  }
  async login(email: string, password: string) {
    const user = await this.users.findOne({
      where: { email },
      select: { id: true, email: true, passwordHash: true },
    });
    // Hash válido fixo para manter o custo de verificação mesmo se o usuário não existir.
    const fallback = '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxdtVh9l7NfRS.oJcFbqTrV9XQy';
    const valid = await compare(password, user?.passwordHash ?? fallback);
    if (!user || !valid) throw new UnauthorizedException('E-mail ou senha inválidos.');
    const token = await this.jwt.signAsync(
      { sub: user.id, email: user.email },
      { secret: this.config.JWT_SECRET, expiresIn: '4h', algorithm: 'HS256' },
    );
    const claims = this.jwt.decode<AuthClaims>(token);
    return {
      token,
      session: {
        user: { id: user.id, email: user.email },
        expiresAt: new Date(claims.exp * 1000).toISOString(),
      },
    };
  }
  async verify(token: string | undefined): Promise<AuthClaims> {
    if (!token) throw new UnauthorizedException('Faça login para continuar.');
    try {
      const claims = await this.jwt.verifyAsync<AuthClaims>(token, {
        secret: this.config.JWT_SECRET,
        algorithms: ['HS256'],
      });
      if (!claims.sub || !claims.email || !claims.exp) throw new Error('Claims inválidas.');
      return claims;
    } catch {
      throw new UnauthorizedException('Sessão expirada ou inválida.');
    }
  }
}
