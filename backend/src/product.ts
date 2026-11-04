import { BadRequestException, Body, Controller, ForbiddenException, Get, Injectable, Post, Req, UseGuards } from '@nestjs/common';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PrismaService } from './prisma.service';
import { AccessTokenGuard, type AuthenticatedRequest } from './security';
import { FREE_HISTORY_LIMIT, FREE_SCENARIO_LIMIT, isPremiumActive, PREMIUM_HISTORY_LIMIT } from './subscription.util';

class PreferencesDto { @IsOptional() @IsBoolean() dailyChallenge?: boolean; @IsOptional() @IsBoolean() threatAlerts?: boolean; @IsOptional() @IsBoolean() monthlyReport?: boolean; @IsOptional() @IsInt() @Min(0) @Max(23) preferredHour?: number; }
class CheckoutDto { @IsString() callbackUrl!: string; }
class PushTokenDto { @IsString() token!: string; @IsIn(['ios', 'android']) platform!: 'ios' | 'android'; }
class ProfileDto { @IsOptional() @IsString() @MaxLength(80) displayName?: string; }

@Injectable()
export class ProductService {
  constructor(private readonly prisma: PrismaService) {}
  private subscription(userId: string) { return this.prisma.subscription.upsert({ where: { userId }, update: {}, create: { userId } }); }
  async dashboard(userId: string) {
    let subscription = await this.subscription(userId);
    // A customer may return from Paystack outside the app (for example in a browser).
    // Reconcile a pending reference on the next authenticated refresh instead of trusting the client.
    if (subscription.status === 'PAST_DUE' && subscription.provider === 'paystack' && subscription.providerReference && process.env.PAYSTACK_SECRET_KEY) {
      try { subscription = await this.verifyCheckout(userId, subscription.providerReference); } catch { /* Payment is still pending or not successful. */ }
    }
    const [user, scans, attempts] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true, username: true, safetyScore: true, xp: true, coins: true, createdAt: true, profile: true, notificationPreferences: true } }),
      this.prisma.aiScan.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, risk: true, score: true, summary: true, createdAt: true, type: true } }),
      this.prisma.scenarioAttempt.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 90, select: { correct: true, createdAt: true } }),
    ]);
    const days = new Set(attempts.filter((a) => a.correct).map((a) => a.createdAt.toISOString().slice(0, 10)));
    let streak = 0; for (let date = new Date(); ; date.setUTCDate(date.getUTCDate() - 1)) { const key = date.toISOString().slice(0, 10); if (!days.has(key)) break; streak++; }
    return { user, subscription, streak, scans };
  }
  async scenarios(userId: string) {
    const subscription = await this.subscription(userId);
    const premium = isPremiumActive(subscription);
    const scenarios = await this.prisma.scenario.findMany({ where: { status: 'PUBLISHED', deletedAt: null }, orderBy: [{ difficulty: 'asc' }, { title: 'asc' }], select: { id: true, title: true, description: true, difficulty: true, content: true, category: { select: { slug: true, name: true } } } });
    if (premium) return scenarios;
    return scenarios.slice(0, FREE_SCENARIO_LIMIT);
  }
  async history(userId: string) {
    const subscription = await this.subscription(userId);
    const limit = isPremiumActive(subscription) ? PREMIUM_HISTORY_LIMIT : FREE_HISTORY_LIMIT;
    return this.prisma.aiScan.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: limit, select: { id: true, type: true, risk: true, score: true, summary: true, redFlags: true, action: true, createdAt: true } });
  }
  async dailyAdvice() {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const advice = await this.prisma.dailySafetyAdvice.findFirst({ where: { activeFrom: { lte: today } }, orderBy: { activeFrom: 'desc' } });
    return advice ?? { id: 'starter-advice', title: 'Pause before you pay', body: 'Pressure is a scammer’s favourite tool. Verify requests using contact details you find independently.', action: 'Verify independently' };
  }
  async registerPushToken(userId: string, dto: PushTokenDto) { return this.prisma.pushToken.upsert({ where: { token: dto.token }, update: { userId, platform: dto.platform }, create: { userId, ...dto } }); }
  async sendPush(userId: string, kind: string, title: string, body: string) {
    const log = await this.prisma.notificationLog.create({ data: { userId, kind, title, body } });
    const tokens = await this.prisma.pushToken.findMany({ where: { userId }, select: { token: true } });
    if (!tokens.length) return { queued: false, reason: 'No registered device', logId: log.id };
    const response = await fetch('https://exp.host/--/api/v2/push/send', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(tokens.map(({ token }) => ({ to: token, sound: 'notification.wav', title, body, data: { destination: 'Home', kind } }))) });
    if (!response.ok) throw new BadRequestException('The push service could not accept the notification');
    await this.prisma.notificationLog.update({ where: { id: log.id }, data: { deliveredAt: new Date() } });
    return { queued: true, logId: log.id };
  }
  async cancelSubscription(userId: string) {
    const subscription = await this.subscription(userId);
    if (!isPremiumActive(subscription)) throw new BadRequestException('There is no active Premium subscription to cancel');
    return this.prisma.subscription.update({ where: { userId }, data: { status: 'CANCELED' } });
  }
  async checkout(userId: string, dto: CheckoutDto) {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) throw new BadRequestException('Premium checkout is not configured yet. Set PAYSTACK_SECRET_KEY on the API server.');
    let parsed: URL; try { parsed = new URL(dto.callbackUrl); } catch { throw new BadRequestException('A valid secure callback URL is required'); }
    if (parsed.protocol !== 'https:') throw new BadRequestException('The callback URL must use HTTPS');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const response = await fetch('https://api.paystack.co/transaction/initialize', { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: user.email, amount: Number(process.env.PREMIUM_MONTHLY_AMOUNT_KOBO ?? 4900), currency: process.env.PREMIUM_CURRENCY ?? 'GHS', callback_url: parsed.toString(), metadata: { userId, plan: 'PREMIUM' } }) });
    const payload = await response.json() as { status: boolean; message?: string; data?: { authorization_url: string; reference: string } };
    if (!response.ok || !payload.status || !payload.data) throw new BadRequestException(payload.message ?? 'Unable to start secure checkout');
    await this.prisma.subscription.upsert({ where: { userId }, update: { provider: 'paystack', providerReference: payload.data.reference, status: 'PAST_DUE' }, create: { userId, provider: 'paystack', providerReference: payload.data.reference, status: 'PAST_DUE' } });
    return { authorizationUrl: payload.data.authorization_url, reference: payload.data.reference };
  }
  async activatePremium(userId: string, reference: string) {
    return this.prisma.subscription.upsert({ where: { userId }, update: { plan: 'PREMIUM', status: 'ACTIVE', provider: 'paystack', providerReference: reference, currentPeriodEndsAt: new Date(Date.now() + 30 * 86400000) }, create: { userId, plan: 'PREMIUM', status: 'ACTIVE', provider: 'paystack', providerReference: reference, currentPeriodEndsAt: new Date(Date.now() + 30 * 86400000) } });
  }
  async verifyCheckout(userId: string, reference: string) {
    const secret = process.env.PAYSTACK_SECRET_KEY; if (!secret) throw new BadRequestException('Premium checkout is not configured yet');
    const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${secret}` } });
    const payload = await response.json() as { status: boolean; data?: { status: string; amount?: number; currency?: string; metadata?: { userId?: string; plan?: string }; reference: string } };
    const expectedAmount = Number(process.env.PREMIUM_MONTHLY_AMOUNT_KOBO ?? 4900);
    const expectedCurrency = process.env.PREMIUM_CURRENCY ?? 'GHS';
    if (!response.ok || !payload.status || payload.data?.status !== 'success' || payload.data.metadata?.userId !== userId || payload.data.metadata.plan !== 'PREMIUM' || payload.data.amount !== expectedAmount || payload.data.currency !== expectedCurrency) throw new BadRequestException('Payment could not be verified');
    return this.activatePremium(userId, reference);
  }
}
@Controller('product') @UseGuards(AccessTokenGuard)
export class ProductController {
  constructor(private readonly product: ProductService, private readonly prisma: PrismaService) {}
  @Get('dashboard') dashboard(@Req() req: AuthenticatedRequest) { return this.product.dashboard(req.user.sub); }
  @Get('scenarios') scenarios(@Req() req: AuthenticatedRequest) { return this.product.scenarios(req.user.sub); }
  @Get('scan-history') history(@Req() req: AuthenticatedRequest) { return this.product.history(req.user.sub); }
  @Get('daily-advice') dailyAdvice() { return this.product.dailyAdvice(); }
  @Post('preferences') async preferences(@Req() req: AuthenticatedRequest, @Body() dto: PreferencesDto) { return this.prisma.notificationPreference.upsert({ where: { userId: req.user.sub }, update: dto, create: { userId: req.user.sub, ...dto } }); }
  @Post('profile') profile(@Req() req: AuthenticatedRequest, @Body() dto: ProfileDto) { return this.prisma.profile.upsert({ where: { userId: req.user.sub }, update: dto, create: { userId: req.user.sub, ...dto } }); }
  @Post('push-token') pushToken(@Req() req: AuthenticatedRequest, @Body() dto: PushTokenDto) { return this.product.registerPushToken(req.user.sub, dto); }
  @Post('notifications/test') testNotification(@Req() req: AuthenticatedRequest) { return this.product.sendPush(req.user.sub, 'test', 'SafeCheck notifications are on', 'You will receive timely safety alerts and reminders here.'); }
  @Post('checkout') checkout(@Req() req: AuthenticatedRequest, @Body() dto: CheckoutDto) { return this.product.checkout(req.user.sub, dto); }
  @Post('checkout/verify') verify(@Req() req: AuthenticatedRequest, @Body('reference') reference: string) { if (!reference) throw new BadRequestException('A payment reference is required'); return this.product.verifyCheckout(req.user.sub, reference); }
  @Post('subscription/cancel') cancelSubscription(@Req() req: AuthenticatedRequest) { return this.product.cancelSubscription(req.user.sub); }
}
