import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { z } from 'zod';
import { CONFIG, Config } from '../config';
import { AuthService } from './auth.service';
import { AuthGuard, AuthRequest } from './auth.guard';

const credentials = z
  .object({
    email: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    password: z
      .string()
      .min(8)
      .refine((value) => Buffer.byteLength(value) <= 72, 'A senha deve ter até 72 bytes.'),
  })
  .strict();

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(CONFIG) private readonly config: Config,
  ) {}
  private parse(body: unknown) {
    const parsed = credentials.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Informe e-mail válido e senha de 8 a 72 bytes.');
    return parsed.data;
  }
  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.config.COOKIE_SECURE === 'true',
      sameSite: 'strict' as const,
      path: '/',
    };
  }
  @Post('bootstrap')
  bootstrap(@Body() body: unknown, @Headers('x-bootstrap-secret') secret: string | undefined) {
    const { email, password } = this.parse(body);
    return this.auth.bootstrap(email, password, secret);
  }
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Res({ passthrough: true }) response: Response) {
    const { email, password } = this.parse(body);
    const result = await this.auth.login(email, password);
    response.cookie('iot_session', result.token, { ...this.cookieOptions(), maxAge: 4 * 60 * 60 * 1000 });
    response.setHeader('Cache-Control', 'no-store');
    return result.session;
  }
  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() request: AuthRequest, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return {
      user: { id: request.auth.sub, email: request.auth.email },
      expiresAt: new Date(request.auth.exp * 1000).toISOString(),
    };
  }
  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('iot_session', this.cookieOptions());
  }
}
