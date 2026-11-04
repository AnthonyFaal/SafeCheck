import { BadRequestException, Body, Controller, Get, Injectable, NotFoundException, Post, Req, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { createHash } from 'crypto';
import { Prisma, RiskLevel, ScanType, ScenarioStatus } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { AccessTokenGuard, type AuthenticatedRequest } from './security';
import { FREE_DAILY_SCAN_LIMIT, isPremiumActive, PREMIUM_DAILY_SCAN_LIMIT } from './subscription.util';
import { InferenceClient, type InferenceResult } from './inference.client';
class ScanDto { @IsString() @Length(3, 5000) content!: string; @IsIn(['MESSAGE', 'URL', 'JOB_OFFER']) type!: 'MESSAGE' | 'URL' | 'JOB_OFFER'; }
class CompleteChallengeDto { @IsString() scenarioId!: string; @IsOptional() @IsString() @Length(1, 200) answer?: string; @IsInt() @Min(0) @Max(600000) reactionMs!: number; }
class CompleteScenarioDto { @IsString() scenarioId!: string; @IsString() @Length(1, 200) answer!: string; @IsInt() @Min(0) @Max(600000) reactionMs!: number; }
type Risk = 'LOW' | 'MEDIUM' | 'HIGH';
@Injectable()
export class SafetyService {
  constructor(private readonly prisma: PrismaService, private readonly inference: InferenceClient) {}
  private redFlags(content: string) { const value = content.toLowerCase(); const rules: [RegExp, string][] = [[/\b(otp|one.?time code|pin)\b/, 'Requests a one-time code or PIN'], [/\b(urgent|immediately|suspend|expire)\b/, 'Uses urgency to stop careful checking'], [/(bit\.ly|tinyurl|http:\/\/)/, 'Contains an unverified or shortened link'], [/\b(fee|deposit|gift card|crypto)\b/, 'Requests payment before a promised outcome']]; return rules.filter(([pattern]) => pattern.test(value)).map(([, flag]) => flag); }
  private report(content: string, inference: InferenceResult, type: ScanDto['type']) {
    const risk: Risk = inference.decision === 'SCAM' ? 'HIGH' : inference.decision === 'REVIEW' ? 'MEDIUM' : 'LOW';
    const score = Math.round(Math.min(1, Math.max(0, inference.probability)) * 100);
    const detectedFlags = this.redFlags(content);
    const subject = type === 'URL' ? 'link' : type === 'JOB_OFFER' ? 'job offer' : 'message';
    // The model can correctly identify a scam even when it does not match one
    // of our short keyword rules. Never present that as "nothing detected".
    const redFlags = detectedFlags.length
      ? detectedFlags
      : risk === 'HIGH'
        ? [`This ${subject} has patterns commonly used in scams`]
        : risk === 'MEDIUM'
          ? [`Something about this ${subject} needs checking before you act`]
          : ['No common scam patterns were found'];
    const summary = risk === 'HIGH' ? `This ${subject} has strong warning signs of a scam.` : risk === 'MEDIUM' ? `Check this ${subject} independently before you act.` : `We found no obvious warning signs in this ${subject}. Stay alert for changes.`;
    const recommendedAction = risk === 'HIGH' ? 'Do not respond, click links, send money, or share codes. Contact the organisation using a trusted channel.' : risk === 'MEDIUM' ? 'Pause and verify the sender through a trusted channel before taking action.' : 'Do not share passwords, PINs, or codes. Verify unexpected requests independently.';
    return { risk, score, summary, redFlags, recommendedAction };
  }
  private async dailyScanLimit(userId: string) {
    const membership = await this.prisma.subscription.findUnique({ where: { userId } });
    return isPremiumActive(membership) ? PREMIUM_DAILY_SCAN_LIMIT : FREE_DAILY_SCAN_LIMIT;
  }
  async scan(userId: string, dto: ScanDto) {
    const startOfDay = new Date(); startOfDay.setUTCHours(0, 0, 0, 0);
    const used = await this.prisma.aiScan.count({ where: { userId, createdAt: { gte: startOfDay } } });
    if (used >= await this.dailyScanLimit(userId)) throw new BadRequestException('Daily scan limit reached. Try again tomorrow or upgrade your plan.');
    let prediction: InferenceResult;
    try { prediction = await this.inference.predict(dto.content); }
    catch (error) {
      if (process.env.ALLOW_RULE_FALLBACK !== 'true') throw error;
      prediction = { decision: 'REVIEW', probability: 0.5, expert_scores: { semantic: 0.5, behavior: 0.5, character: 0.5 } };
      if (!(error instanceof ServiceUnavailableException)) throw error;
    }
    const report = this.report(dto.content, prediction, dto.type);
    await this.prisma.$transaction(async (tx) => {
      const used = await tx.aiScan.count({
        where: { userId, createdAt: { gte: startOfDay } },
      });
      if (used >= await this.dailyScanLimit(userId)) {
        throw new BadRequestException(
          'Daily scan limit reached. Try again tomorrow or upgrade your plan.',
        );
      }
      await tx.aiScan.create({
        data: {
          userId,
          type: dto.type as ScanType,
          risk: report.risk as RiskLevel,
          score: report.score,
          summary: report.summary,
          redFlags: report.redFlags,
          action: report.recommendedAction,
          contentHash: createHash('sha256').update(dto.content).digest('hex'),
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return report;
  }
  async dailyChallenge(userId: string) {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const existing = await this.prisma.dailyChallenge.findUnique({ where: { userId_date: { userId, date: today } } });
    let scenarioId = existing?.scenarioId;
    if (!scenarioId) {
      const scenarios = await this.prisma.scenario.findMany({ where: { status: ScenarioStatus.PUBLISHED, deletedAt: null }, orderBy: [{ difficulty: 'asc' }, { createdAt: 'asc' }], select: { id: true } });
      if (!scenarios.length) throw new NotFoundException('No published challenge is available');
      const epochDay = Math.floor(today.getTime() / 86_400_000);
      scenarioId = scenarios[epochDay % scenarios.length].id;
    }
    const challenge = existing ?? await this.prisma.dailyChallenge.create({ data: { userId, scenarioId, date: today } });
    return { id: challenge.id, completedAt: challenge.completedAt, scenario: await this.prisma.scenario.findUniqueOrThrow({ where: { id: scenarioId }, select: { id: true, title: true, description: true, difficulty: true, content: true, category: { select: { slug: true, name: true } } } }) };
  }
  async completeChallenge(userId: string, dto: CompleteChallengeDto) {
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    return this.prisma.$transaction(async (tx) => {
      const challenge = await tx.dailyChallenge.findUnique({ where: { userId_date: { userId, date: today } } });
      if (!challenge || challenge.scenarioId !== dto.scenarioId) throw new BadRequestException('This is not your current daily challenge');
      if (challenge.completedAt) throw new BadRequestException('Today’s challenge has already been completed');
      const scenario = await tx.scenario.findUniqueOrThrow({ where: { id: dto.scenarioId }, select: { content: true } });
      const expected = typeof scenario.content === 'object' && scenario.content && 'correctAnswer' in scenario.content ? (scenario.content as { correctAnswer?: unknown }).correctAnswer : undefined;
      if (typeof expected !== 'string') throw new BadRequestException('This challenge is missing its answer key');
      const correct = dto.answer === expected;
      const attempt = await tx.scenarioAttempt.create({ data: { userId, scenarioId: dto.scenarioId, correct, reactionMs: dto.reactionMs, answers: dto.answer ? { answer: dto.answer } : undefined } });
      const xp = correct ? 20 : 8; const score = correct ? 2 : 0;
      const user = await tx.user.update({ where: { id: userId }, data: { xp: { increment: xp }, coins: { increment: correct ? 10 : 3 }, safetyScore: { increment: score } }, select: { xp: true, coins: true, safetyScore: true } });
      await tx.dailyChallenge.update({ where: { id: challenge.id }, data: { completedAt: new Date() } });
      return { attemptId: attempt.id, correct, rewards: { xp, coins: correct ? 10 : 3, safetyScore: score }, user };
    });
  }
  async completeScenario(userId: string, dto: CompleteScenarioDto) {
    return this.prisma.$transaction(async (tx) => {
      const scenario = await tx.scenario.findFirst({ where: { id: dto.scenarioId, status: ScenarioStatus.PUBLISHED, deletedAt: null }, select: { content: true } });
      if (!scenario) throw new NotFoundException('This scenario is not available');
      const expected = typeof scenario.content === 'object' && scenario.content && 'correctAnswer' in scenario.content ? (scenario.content as { correctAnswer?: unknown }).correctAnswer : undefined;
      if (typeof expected !== 'string') throw new BadRequestException('This scenario is missing its answer key');
      const correct = dto.answer === expected;
      const xp = correct ? 15 : 5;
      const coins = correct ? 6 : 1;
      const attempt = await tx.scenarioAttempt.create({ data: { userId, scenarioId: dto.scenarioId, correct, reactionMs: dto.reactionMs, answers: { answer: dto.answer } } });
      const user = await tx.user.update({ where: { id: userId }, data: { xp: { increment: xp }, coins: { increment: coins }, safetyScore: correct ? { increment: 1 } : undefined }, select: { xp: true, coins: true, safetyScore: true } });
      return { attemptId: attempt.id, correct, rewards: { xp, coins, safetyScore: correct ? 1 : 0 }, user };
    });
  }
}
@Controller('safety') @UseGuards(AccessTokenGuard)
export class SafetyController {
  constructor(private readonly safety: SafetyService) {}
  @Post('scans') scan(@Req() req: AuthenticatedRequest, @Body() dto: ScanDto) { return this.safety.scan(req.user.sub, dto); }
  @Get('daily-challenge') dailyChallenge(@Req() req: AuthenticatedRequest) { return this.safety.dailyChallenge(req.user.sub); }
  @Post('daily-challenge/complete') complete(@Req() req: AuthenticatedRequest, @Body() dto: CompleteChallengeDto) { return this.safety.completeChallenge(req.user.sub, dto); }
  @Post('scenario-attempts') completeScenario(@Req() req: AuthenticatedRequest, @Body() dto: CompleteScenarioDto) { return this.safety.completeScenario(req.user.sub, dto); }
}
