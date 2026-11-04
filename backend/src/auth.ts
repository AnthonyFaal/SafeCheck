import { Body, ConflictException, Controller, Delete, ForbiddenException, Get, Injectable, InternalServerErrorException, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { randomInt, randomUUID } from 'crypto';
import { PrismaService } from './prisma.service';
import { AccessTokenGuard, type AuthenticatedRequest } from './security';
import { MailService } from './mail.service';
import { Throttle } from '@nestjs/throttler';

class RegisterDto { @IsEmail() email!: string; @IsString() @Length(3, 32) @Matches(/^[a-zA-Z0-9_]+$/) username!: string; @IsString() @Length(10, 128) password!: string; @IsOptional() @IsString() deviceName?: string; }
class LoginDto { @IsEmail() email!: string; @IsString() password!: string; @IsOptional() @IsString() deviceName?: string; }
class RefreshDto { @IsString() refreshToken!: string; }
class ChangePasswordDto { @IsString() currentPassword!: string; @IsString() @Length(10, 128) newPassword!: string; }
class VerifyEmailDto { @IsEmail() email!: string; @IsString() @Matches(/^\d{6}$/) code!: string; @IsOptional() @IsString() deviceName?: string; }
class ResendVerificationDto { @IsEmail() email!: string; }

@Injectable()
export class AuthService {
  private readonly accessJwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET, signOptions: { expiresIn: '15m' } });
  private readonly refreshJwt = new JwtService({ secret: process.env.JWT_REFRESH_SECRET, signOptions: { expiresIn: '30d' } });
  constructor(private readonly prisma: PrismaService, private readonly mail: MailService) {}
  private configured() { if (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET) throw new InternalServerErrorException('Authentication is not configured'); }
  private async tokens(user: { id: string; email: string; username: string; role: 'USER' | 'MODERATOR' | 'ADMIN' }, deviceName?: string) {
    this.configured();
    const session = await this.prisma.session.create({ data: { userId: user.id, refreshTokenHash: 'pending', deviceName, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } });
    const accessToken = this.accessJwt.sign({ sub: user.id, email: user.email, role: user.role });
    const refreshToken = this.refreshJwt.sign({ sub: user.id, sid: session.id });
    await this.prisma.session.update({ where: { id: session.id }, data: { refreshTokenHash: await bcrypt.hash(refreshToken, 12) } });
    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: 900, user: { id: user.id, email: user.email, username: user.username, role: user.role } };
  }
  private async issueVerification(userId: string, email: string) {
    const recent = await this.prisma.emailOtp.count({ where: { userId, createdAt: { gt: new Date(Date.now() - 60 * 60_000) } } });
    if (recent >= 5) throw new ForbiddenException('Too many verification emails. Please wait an hour and try again.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.prisma.emailOtp.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: new Date() } });
    await this.prisma.emailOtp.create({ data: { userId, codeHash: await bcrypt.hash(code, 12), expiresAt: new Date(Date.now() + 10 * 60_000) } });
    await this.mail.sendVerificationCode(email, code);
  }
  async register(dto: RegisterDto) { const email = dto.email.toLowerCase(); const found = await this.prisma.user.findFirst({ where: { OR: [{ email }, { username: dto.username }] } }); if (found) throw new ConflictException('Email or username is already registered'); const user = await this.prisma.user.create({ data: { email, username: dto.username, passwordHash: await bcrypt.hash(dto.password, 12), profile: { create: {} }, notificationPreferences: { create: {} } } }); await this.issueVerification(user.id, user.email); return { verificationRequired: true, email: user.email }; }
  async login(dto: LoginDto) { const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } }); if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) throw new UnauthorizedException('Invalid email or password'); if (!user.emailVerifiedAt) { await this.issueVerification(user.id, user.email); throw new ForbiddenException('Your email is not verified. A new verification code has been sent.'); } return this.tokens(user, dto.deviceName); }
  async verifyEmail(dto: VerifyEmailDto) { const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } }); if (!user) throw new UnauthorizedException('Invalid verification code'); if (user.emailVerifiedAt) return this.tokens(user, dto.deviceName); const otp = await this.prisma.emailOtp.findFirst({ where: { userId: user.id, consumedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } }); if (!otp || !(await bcrypt.compare(dto.code, otp.codeHash))) throw new UnauthorizedException('Invalid or expired verification code'); await this.prisma.$transaction([this.prisma.emailOtp.update({ where: { id: otp.id }, data: { consumedAt: new Date() } }), this.prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } })]); return this.tokens(user, dto.deviceName); }
  async resendVerification(email: string) { const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } }); if (user && !user.emailVerifiedAt) await this.issueVerification(user.id, user.email); return { sent: true }; }
  async refresh(dto: RefreshDto) { this.configured(); let payload: { sub: string; sid: string }; try { payload = this.refreshJwt.verify(dto.refreshToken); } catch { throw new UnauthorizedException('The refresh token is invalid or expired'); } const session = await this.prisma.session.findUnique({ where: { id: payload.sid }, include: { user: true } }); if (!session || session.userId !== payload.sub || session.revokedAt || session.expiresAt < new Date() || !(await bcrypt.compare(dto.refreshToken, session.refreshTokenHash))) throw new UnauthorizedException('The session is no longer valid'); await this.prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } }); return this.tokens(session.user, session.deviceName ?? undefined); }
  async logout(userId: string) { await this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }); return { success: true }; }
  async changePassword(userId: string, dto: ChangePasswordDto) { const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } }); if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) throw new UnauthorizedException('Your current password is incorrect'); await this.prisma.$transaction([this.prisma.user.update({ where: { id: userId }, data: { passwordHash: await bcrypt.hash(dto.newPassword, 12) } }), this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } })]); return { success: true }; }
  async deleteAccount(userId: string, password: string) { const user = await this.prisma.user.findUnique({ where: { id: userId } }); if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw new UnauthorizedException('Your current password is required'); await this.prisma.$transaction([this.prisma.session.updateMany({ where: { userId }, data: { revokedAt: new Date() } }), this.prisma.pushToken.deleteMany({ where: { userId } }), this.prisma.notificationLog.deleteMany({ where: { userId } }), this.prisma.emailOtp.deleteMany({ where: { userId } }), this.prisma.profile.deleteMany({ where: { userId } }), this.prisma.notificationPreference.deleteMany({ where: { userId } }), this.prisma.user.update({ where: { id: userId }, data: { deletedAt: new Date(), email: `deleted-${user.id}@invalid.local`, username: `deleted_${user.id.replace(/-/g, '')}`, passwordHash: await bcrypt.hash(randomUUID(), 12) } })]); return { success: true }; }
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly prisma: PrismaService) {}
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) @Post('register') register(@Body() dto: RegisterDto) { return this.auth.register(dto); }
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) @Post('login') login(@Body() dto: LoginDto) { return this.auth.login(dto); }
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Post('verify-email') verifyEmail(@Body() dto: VerifyEmailDto) { return this.auth.verifyEmail(dto); }
  @Throttle({ default: { limit: 3, ttl: 60_000 } }) @Post('resend-verification') resendVerification(@Body() dto: ResendVerificationDto) { return this.auth.resendVerification(dto.email); }
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) @Post('refresh') refresh(@Body() dto: RefreshDto) { return this.auth.refresh(dto); }
  @UseGuards(AccessTokenGuard) @Post('logout') logout(@Req() req: AuthenticatedRequest) { return this.auth.logout(req.user.sub); }
  @UseGuards(AccessTokenGuard) @Post('change-password') changePassword(@Req() req: AuthenticatedRequest, @Body() dto: ChangePasswordDto) { return this.auth.changePassword(req.user.sub, dto); }
  @UseGuards(AccessTokenGuard) @Delete('account') deleteAccount(@Req() req: AuthenticatedRequest, @Body('password') password: string) { return this.auth.deleteAccount(req.user.sub, password ?? ''); }
  @UseGuards(AccessTokenGuard) @Get('me') async me(@Req() req: AuthenticatedRequest) { return this.prisma.user.findUniqueOrThrow({ where: { id: req.user.sub }, select: { id: true, email: true, username: true, role: true, safetyScore: true, xp: true, coins: true, profile: true } }); }
}
