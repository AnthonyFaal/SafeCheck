import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Injectable,
  NotFoundException,
  Patch,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { createHash, randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from './prisma.service';
import { AccessTokenGuard, type AuthenticatedRequest } from './security';

class QuestionDto {
  @IsString() @Length(5, 500) prompt!: string;
  @IsArray() @IsString({ each: true }) choices!: string[];
  @IsString() @Length(1, 200) correctAnswer!: string;
  @IsOptional() @IsString() @Length(1, 500) explanation?: string;
}
class CreateSessionDto {
  @IsString() @Length(3, 80) title!: string;
  @IsOptional() @IsString() @Length(1, 280) description?: string;
  @IsOptional() @IsDateString() scheduledFor?: string;
  @IsOptional() @IsString() @Length(1, 64) timezone?: string;
  @IsInt() @Min(10) @Max(90) questionSeconds!: number;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions!: QuestionDto[];
}
class JoinDto {
  @IsString() @Length(4, 12) code!: string;
  @IsString() @Length(2, 32) displayName!: string;
}
class AnswerDto {
  @IsString() @Length(1, 200) answer!: string;
}
class RescheduleDto {
  @IsDateString() scheduledFor!: string;
}

@Injectable()
export class GroupSessionService {
  constructor(private readonly prisma: PrismaService) {}
  private tokenKey(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  private code() {
    return randomBytes(4).toString('hex').slice(0, 6).toUpperCase();
  }
  private async sessionOrThrow(id: string) {
    const session = await this.prisma.liveSession.findUnique({
      where: { id },
      include: { questions: { orderBy: { position: 'asc' } } },
    });
    if (!session) throw new NotFoundException('This session no longer exists');
    return session;
  }
  async create(hostId: string, dto: CreateSessionDto) {
    if (dto.questions.length < 1 || dto.questions.length > 25)
      throw new BadRequestException('Create between 1 and 25 questions');
    for (const q of dto.questions) {
      const unique = [
        ...new Set(q.choices.map((choice) => choice.trim()).filter(Boolean)),
      ];
      if (
        unique.length < 2 ||
        unique.length > 4 ||
        !unique.includes(q.correctAnswer.trim())
      )
        throw new BadRequestException(
          'Each question needs 2–4 choices including the correct answer',
        );
    }
    let code = this.code();
    while (
      await this.prisma.liveSession.findUnique({
        where: { code },
        select: { id: true },
      })
    )
      code = this.code();
    const scheduledFor = dto.scheduledFor ? new Date(dto.scheduledFor) : null;
    if (scheduledFor && scheduledFor.getTime() < Date.now() - 60_000)
      throw new BadRequestException('Choose a future start time or start the session now');
    const sessionToken = randomBytes(32).toString('hex');
    const session = await this.prisma.liveSession.create({
      data: {
        code,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        scheduledFor,
        timezone: dto.timezone?.trim() || null,
        status: scheduledFor && scheduledFor.getTime() > Date.now() ? 'SCHEDULED' : 'LOBBY',
        hostId,
        questionSeconds: dto.questionSeconds,
        players: {
          create: {
            userId: hostId,
            guestTokenHash: await bcrypt.hash(sessionToken, 12),
            guestTokenKey: this.tokenKey(sessionToken),
          },
        },
        questions: {
          create: dto.questions.map((q, position) => ({
            position,
            prompt: q.prompt.trim(),
            choices: q.choices.map((choice) => choice.trim()),
            correctAnswer: q.correctAnswer.trim(),
            explanation: q.explanation?.trim(),
          })),
        },
      },
      select: { id: true, code: true, title: true, status: true },
    });
    return { ...session, sessionToken };
  }
  async join(userId: string, code: string, displayName: string) {
    const session = await this.prisma.liveSession.findUnique({
      where: { code: code.trim().toUpperCase() },
    });
    if (!session)
      throw new NotFoundException('Check the session code and try again');
    if (!['SCHEDULED', 'LOBBY'].includes(session.status))
      throw new BadRequestException('This event is no longer accepting participants');
    const existing = await this.prisma.liveSessionPlayer.findUnique({ where: { sessionId_userId: { sessionId: session.id, userId } } });
    if (!existing && await this.prisma.liveSessionPlayer.count({ where: { sessionId: session.id } }) >= 200)
      throw new BadRequestException('This session is full');
    const sessionToken = randomBytes(32).toString('hex');
    const tokenData = { guestTokenHash: await bcrypt.hash(sessionToken, 12), guestTokenKey: this.tokenKey(sessionToken), displayName: displayName.trim(), lastSeenAt: new Date() };
    if (existing) await this.prisma.liveSessionPlayer.update({ where: { id: existing.id }, data: tokenData });
    else await this.prisma.liveSessionPlayer.create({ data: { sessionId: session.id, userId, ...tokenData } });
    return {
      id: session.id,
      code: session.code,
      title: session.title,
      sessionToken,
    };
  }
  async start(hostId: string, id: string) {
    const session = await this.sessionOrThrow(id);
    if (session.hostId !== hostId)
      throw new BadRequestException('Only the creator can start the session');
    if (!['SCHEDULED', 'LOBBY'].includes(session.status))
      throw new BadRequestException('This session cannot be started');
    if (session.scheduledFor && session.scheduledFor.getTime() > Date.now() + 60_000)
      throw new BadRequestException('This event is scheduled for later. Start it at the scheduled time.');
    const playerCount = await this.prisma.liveSessionPlayer.count({ where: { sessionId: id } });
    if (playerCount < 2)
      throw new BadRequestException('Invite at least one other player before starting');
    return this.prisma.liveSession.update({
      where: { id },
      data: {
        status: 'LIVE',
        questionStartedAt: new Date(),
        currentQuestion: 0,
      },
    });
  }
  private async playerWithToken(sessionId: string, sessionToken: string) {
    if (!sessionToken || sessionToken.length < 32)
      throw new BadRequestException('A valid session token is required');
    const tokenKey = this.tokenKey(sessionToken);
    const indexedPlayer = await this.prisma.liveSessionPlayer.findUnique({
      where: { guestTokenKey: tokenKey },
    });
    if (indexedPlayer?.sessionId === sessionId) return indexedPlayer;
    // Sessions created before token keys were introduced remain usable. Once a
    // legacy player reconnects, upgrade it so future polls use the index.
    const players = await this.prisma.liveSessionPlayer.findMany({ where: { sessionId, guestTokenHash: { not: null } } });
    const player = (
      await Promise.all(
        players.map(async (candidate) =>
          candidate.guestTokenHash &&
          (await bcrypt.compare(sessionToken, candidate.guestTokenHash))
            ? candidate
            : null,
        ),
      )
    ).find(Boolean);
    if (!player)
      throw new BadRequestException(
        'Your session access has expired. Join again to continue.',
      );
    await this.prisma.liveSessionPlayer.update({ where: { id: player.id }, data: { guestTokenKey: tokenKey } });
    return player;
  }
  async answer(sessionToken: string, id: string, dto: AnswerDto) {
    const session = await this.sessionOrThrow(id);
    if (session.status !== 'LIVE' || !session.questionStartedAt)
      throw new BadRequestException('The session is not accepting answers');
    const question = session.questions[session.currentQuestion];
    if (!question) throw new BadRequestException('There is no active question');
    const choices =
      Array.isArray(question.choices) &&
      question.choices.every(
        (choice): choice is string => typeof choice === 'string',
      )
        ? question.choices
        : [];
    if (!choices.includes(dto.answer))
      throw new BadRequestException('Choose one of the available answers');
    const elapsed = Date.now() - session.questionStartedAt.getTime();
    if (elapsed > session.questionSeconds * 1000)
      throw new BadRequestException('Time is up for this question');
    const player = await this.playerWithToken(id, sessionToken);
    const correct = dto.answer === question.correctAnswer;
    const points = correct
      ? Math.max(
          100,
          Math.round(1000 * (1 - elapsed / (session.questionSeconds * 1000))),
        )
      : 0;
    try {
      await this.prisma.$transaction([
        this.prisma.liveSessionAnswer.create({
          data: {
            playerId: player.id,
            questionId: question.id,
            answer: dto.answer,
            correct,
            points,
          },
        }),
        this.prisma.liveSessionPlayer.update({
          where: { id: player.id },
          data: { score: { increment: points } },
        }),
      ]);
    } catch {
      throw new BadRequestException('You already answered this question');
    }
    return { correct, points };
  }
  async advance(hostId: string, id: string) {
    const session = await this.sessionOrThrow(id);
    if (session.hostId !== hostId)
      throw new BadRequestException('Only the creator can advance questions');
    if (session.status !== 'LIVE')
      throw new BadRequestException('This session is not live');
    if (
      session.questionStartedAt &&
      Date.now() - session.questionStartedAt.getTime() <
        session.questionSeconds * 1000
    )
      throw new BadRequestException(
        'Wait for the timer to finish so every player gets the same chance',
      );
    const next = session.currentQuestion + 1;
    return this.prisma.liveSession.update({
      where: { id },
      data:
        next >= session.questions.length
          ? { status: 'FINISHED', finishedAt: new Date() }
          : { currentQuestion: next, questionStartedAt: new Date() },
    });
  }
  async end(hostId: string, id: string) {
    const session = await this.sessionOrThrow(id);
    if (session.hostId !== hostId)
      throw new BadRequestException('Only the creator can end the session');
    if (session.status === 'FINISHED') return session;
    return this.prisma.liveSession.update({
      where: { id },
      data: { status: 'FINISHED', finishedAt: new Date() },
    });
  }
  async cancel(hostId: string, id: string) {
    const session = await this.sessionOrThrow(id);
    if (session.hostId !== hostId)
      throw new BadRequestException('Only the creator can cancel this event');
    if (!['SCHEDULED', 'LOBBY'].includes(session.status))
      throw new BadRequestException('Only an upcoming event can be canceled');
    return this.prisma.liveSession.update({ where: { id }, data: { status: 'CANCELED', canceledAt: new Date() } });
  }
  async reschedule(hostId: string, id: string, scheduledFor: string) {
    const session = await this.sessionOrThrow(id);
    const date = new Date(scheduledFor);

    if (session.hostId !== hostId)
      throw new BadRequestException('Only the creator can reschedule this event');
    if (session.status !== 'SCHEDULED')
      throw new BadRequestException('Only scheduled events can be rescheduled');
    if (date.getTime() <= Date.now())
      throw new BadRequestException('Choose a future start time');

    return this.prisma.liveSession.update({
      where: { id },
      data: { scheduledFor: date },
    });
  }
  async mine(userId: string) {
    const sessions = await this.prisma.liveSession.findMany({
      where: { OR: [{ hostId: userId }, { players: { some: { userId } } }] },
      orderBy: [{ scheduledFor: 'asc' }, { createdAt: 'desc' }],
      take: 30,
      include: { _count: { select: { players: true, questions: true } }, players: { where: { userId }, select: { score: true, joinedAt: true } } },
    });
    return sessions.map((session) => ({
      id: session.id, code: session.code, title: session.title, description: session.description,
      status: session.status, scheduledFor: session.scheduledFor, timezone: session.timezone,
      isHost: session.hostId === userId, playerCount: session._count.players,
      questionCount: session._count.questions, score: session.players[0]?.score ?? 0,
      createdAt: session.createdAt, finishedAt: session.finishedAt,
    }));
  }
  async state(sessionToken: string, id: string) {
    const session = await this.sessionOrThrow(id);
    const player = await this.playerWithToken(id, sessionToken);
    await this.prisma.liveSessionPlayer.update({ where: { id: player.id }, data: { lastSeenAt: new Date() } });
    const leaderboard = await this.prisma.liveSessionPlayer.findMany({
      where: { sessionId: id },
      orderBy: [{ score: 'desc' }, { joinedAt: 'asc' }],
      take: 200,
      select: {
        id: true,
        userId: true,
        displayName: true,
        score: true,
        user: {
          select: {
            username: true,
            profile: { select: { displayName: true } },
          },
        },
      },
    });
    const question =
      session.status === 'LIVE'
        ? session.questions[session.currentQuestion]
        : null;
    const elapsedMs =
      question && session.questionStartedAt
        ? Date.now() - session.questionStartedAt.getTime()
        : 0;
    const remainingMs = question
      ? Math.max(0, session.questionSeconds * 1000 - elapsedMs)
      : 0;
    const phase = question
      ? remainingMs > 0
        ? 'ANSWERING'
        : 'REVEAL'
      : 'WAITING';
    const [answer, answeredCount, playerCount] = question
      ? await Promise.all([
          this.prisma.liveSessionAnswer.findUnique({
            where: {
              playerId_questionId: {
                playerId: player.id,
                questionId: question.id,
              },
            },
            select: { answer: true, correct: true, points: true },
          }),
          this.prisma.liveSessionAnswer.count({
            where: { questionId: question.id },
          }),
          this.prisma.liveSessionPlayer.count({ where: { sessionId: id } }),
        ])
      : [
          null,
          0,
          await this.prisma.liveSessionPlayer.count({
            where: { sessionId: id },
          }),
        ];
    return {
      id: session.id,
      code: session.code,
      title: session.title,
      description: session.description,
      status: session.status,
      scheduledFor: session.scheduledFor,
      timezone: session.timezone,
      isHost: session.hostId === player.userId,
      questionSeconds: session.questionSeconds,
      playerCount,
      question: question
        ? {
            id: question.id,
            position: question.position + 1,
            total: session.questions.length,
            prompt: question.prompt,
            choices: question.choices,
            remainingMs,
            phase,
            answeredCount,
            answer,
            ...(phase === 'REVEAL'
              ? {
                  correctAnswer: question.correctAnswer,
                  explanation:
                    question.explanation ??
                    'Time is up — discuss the safest next step before moving on.',
                }
              : {}),
          }
        : null,
      leaderboard: leaderboard.map((entry, index) => ({
        rank: index + 1,
        name:
          entry.user?.profile?.displayName ||
          entry.user?.username ||
          entry.displayName ||
          'Guest',
        score: entry.score,
        isYou:
          (entry.userId === player.userId && player.userId !== null) ||
          entry.id === player.id,
      })),
    };
  }
}
@Controller('sessions')
export class GroupSessionController {
  constructor(private readonly sessions: GroupSessionService) {}
  @UseGuards(AccessTokenGuard) @Post() create(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateSessionDto,
  ) {
    return this.sessions.create(req.user.sub, dto);
  }
  @UseGuards(AccessTokenGuard) @Post('join') join(@Req() req: AuthenticatedRequest, @Body() dto: JoinDto) {
    return this.sessions.join(req.user.sub, dto.code, dto.displayName);
  }
  @UseGuards(AccessTokenGuard) @Post(':id/start') start(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.sessions.start(req.user.sub, id);
  }
  @Post(':id/answer') answer(
    @Headers('x-session-token') token: string,
    @Param('id') id: string,
    @Body() dto: AnswerDto,
  ) {
    return this.sessions.answer(token, id, dto);
  }
  @UseGuards(AccessTokenGuard) @Post(':id/advance') advance(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.sessions.advance(req.user.sub, id);
  }
  @UseGuards(AccessTokenGuard) @Post(':id/end') end(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) {
    return this.sessions.end(req.user.sub, id);
  }
  @UseGuards(AccessTokenGuard) @Post(':id/cancel') cancel(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
  ) { return this.sessions.cancel(req.user.sub, id); }
  @UseGuards(AccessTokenGuard) @Patch(':id/schedule') reschedule(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: RescheduleDto,
  ) { return this.sessions.reschedule(req.user.sub, id, dto.scheduledFor); }
  @UseGuards(AccessTokenGuard) @Get('me/events') mine(@Req() req: AuthenticatedRequest) {
    return this.sessions.mine(req.user.sub);
  }
  @Get(':id') state(
    @Headers('x-session-token') token: string,
    @Param('id') id: string,
  ) {
    return this.sessions.state(token, id);
  }
}
