import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export type AuthenticatedRequest = Request & { user: { sub: string; email: string; role: 'USER' | 'MODERATOR' | 'ADMIN' } };

@Injectable()
export class AccessTokenGuard implements CanActivate {
  private readonly jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
  canActivate(context: ExecutionContext): boolean {
    if (!process.env.JWT_ACCESS_SECRET) throw new UnauthorizedException('Authentication is not configured');
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!token) throw new UnauthorizedException('A bearer token is required');
    try { request.user = this.jwt.verify(token); return true; }
    catch { throw new UnauthorizedException('The access token is invalid or expired'); }
  }
}
