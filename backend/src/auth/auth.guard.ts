import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AuthClaims, AuthService } from './auth.service';

export type AuthRequest = Request & { auth: AuthClaims };
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    request.auth = await this.auth.verify(request.cookies?.iot_session);
    return true;
  }
}
