import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth';
import { PrismaService } from './prisma.service';
import { MailService } from './mail.service';

jest.mock('./mail.service');

type PrismaStub = {
  user: Record<string, jest.Mock>;
  emailOtp: Record<string, jest.Mock>;
  session: Record<string, jest.Mock>;
  pushToken: { deleteMany: jest.Mock };
  notificationLog: { deleteMany: jest.Mock };
  profile: { deleteMany: jest.Mock };
  notificationPreference: { deleteMany: jest.Mock };
  $transaction: jest.Mock;
};

function makePrisma(): PrismaStub {
  let sessionSeq = 0;
  return {
    user: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    emailOtp: {
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn(),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    session: {
      create: jest.fn().mockImplementation(({ data }) => Promise.resolve({ id: `s-${++sessionSeq}`, ...data })),
      update: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    pushToken: { deleteMany: jest.fn() },
    notificationLog: { deleteMany: jest.fn() },
    profile: { deleteMany: jest.fn() },
    notificationPreference: { deleteMany: jest.fn() },
    $transaction: jest.fn(async (ops: unknown[]) => ops),
  };
}

async function buildService(prisma: PrismaStub) {
  const moduleRef = await Test.createTestingModule({
    providers: [
      AuthService,
      { provide: PrismaService, useValue: prisma },
      { provide: MailService, useValue: { sendVerificationCode: jest.fn() } },
    ],
  }).compile();
  return { service: moduleRef.get(AuthService), prisma };
}

const user = {
  id: 'u1',
  email: 'user@test.dev',
  username: 'user',
  role: 'USER' as const,
  emailVerifiedAt: new Date(),
};

async function verifiedUserWithPassword(password: string, emailVerifiedAt: Date | null = new Date()) {
  return { ...user, emailVerifiedAt, passwordHash: await bcrypt.hash(password, 4) };
}

beforeAll(() => {
  process.env.JWT_ACCESS_SECRET = 'test-access-secret';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';
});

describe('AuthService.login', () => {
  it('rejects an unknown email', async () => {
    const { service, prisma } = await buildService(makePrisma());
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      service.login({ email: 'user@test.dev', password: 'pw123456789' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(prisma.emailOtp.create).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('rejects a wrong password', async () => {
    const { service, prisma } = await buildService(makePrisma());
    prisma.user.findUnique.mockResolvedValue(
      await verifiedUserWithPassword('correct-password'),
    );
    await expect(
      service.login({ email: 'user@test.dev', password: 'wrong-password' }),
    ).rejects.toThrow(UnauthorizedException);
    expect(prisma.emailOtp.create).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('forces verification and re-issues an OTP for unverified users', async () => {
    const { service, prisma } = await buildService(makePrisma());
    prisma.user.findUnique.mockResolvedValue(
      await verifiedUserWithPassword('correct-password', null),
    );
    await expect(
      service.login({ email: 'user@test.dev', password: 'correct-password' }),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.emailOtp.create).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService.verifyEmail', () => {
  it('rejects an expired OTP', async () => {
    const { service, prisma } = await buildService(makePrisma());
    prisma.user.findUnique.mockResolvedValue({ ...user, emailVerifiedAt: null });
    // The service queries for an unconsumed OTP with expiresAt > now, so an
    // expired code is filtered out by the database and findFirst returns null.
    prisma.emailOtp.findFirst.mockResolvedValue(null);
    await expect(
      service.verifyEmail({ email: 'user@test.dev', code: '123456' }),
    ).rejects.toThrow('Invalid or expired verification code');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.emailOtp.updateMany).not.toHaveBeenCalled();
    expect(prisma.emailOtp.update).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('does not consume an OTP whose code hash does not match', async () => {
    const { service, prisma } = await buildService(makePrisma());
    prisma.user.findUnique.mockResolvedValue({ ...user, emailVerifiedAt: null });
    prisma.emailOtp.findFirst.mockResolvedValue({
      id: 'otp1',
      codeHash: await bcrypt.hash('123456', 4),
    });
    await expect(
      service.verifyEmail({ email: 'user@test.dev', code: '999999' }),
    ).rejects.toThrow('Invalid or expired verification code');
    expect(prisma.emailOtp.update).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });

  it('consumes the OTP and verifies the email on a valid code', async () => {
    const { service, prisma } = await buildService(makePrisma());
    prisma.user.findUnique.mockResolvedValue({ ...user, emailVerifiedAt: null });
    prisma.emailOtp.findFirst.mockResolvedValue({
      id: 'otp1',
      codeHash: await bcrypt.hash('654321', 4),
    });
    const result = await service.verifyEmail({ email: 'user@test.dev', code: '654321' });
    expect(result.accessToken).toBeTruthy();
    expect(prisma.session.create).toHaveBeenCalledTimes(1);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: user.id } }),
    );
  });

  it('rejects when the OTP was already consumed', async () => {
    const { service, prisma } = await buildService(makePrisma());
    prisma.user.findUnique.mockResolvedValue({ ...user, emailVerifiedAt: null });
    prisma.emailOtp.findFirst.mockResolvedValue(null);
    await expect(
      service.verifyEmail({ email: 'user@test.dev', code: '654321' }),
    ).rejects.toThrow('Invalid or expired verification code');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.emailOtp.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a code that does not match the stored hash', async () => {
    const { service, prisma } = await buildService(makePrisma());
    prisma.user.findUnique.mockResolvedValue({ ...user, emailVerifiedAt: null });
    prisma.emailOtp.findFirst.mockResolvedValue(null);
    await expect(
      service.verifyEmail({ email: 'user@test.dev', code: '000000' }),
    ).rejects.toThrow('Invalid or expired verification code');
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.session.create).not.toHaveBeenCalled();
  });
});

describe('AuthService.refresh', () => {
  it('rejects a malformed refresh token', async () => {
    const { service } = await buildService(makePrisma());
    await expect(service.refresh({ refreshToken: 'garbage' })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rotates the session: revokes the old one and creates a new one', async () => {
    const { service, prisma } = await buildService(makePrisma());
    prisma.user.findUnique.mockResolvedValue(
      await verifiedUserWithPassword('correct-password'),
    );
    const issued = await service.login({ email: user.email, password: 'correct-password' });
    prisma.session.findUnique.mockResolvedValue({
      id: 's1',
      userId: user.id,
      deviceName: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 86_400_000),
      refreshTokenHash: await bcrypt.hash(issued.refreshToken, 4),
      user,
    });
    const result = await service.refresh({ refreshToken: issued.refreshToken });
    expect(result.refreshToken).not.toEqual(issued.refreshToken);
    expect(prisma.session.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' } }),
    );
    expect(prisma.session.create).toHaveBeenCalledTimes(2);
  });

  it('rejects a revoked session', async () => {
    const { service, prisma } = await buildService(makePrisma());
    const refreshJwt = new JwtService({ secret: 'test-refresh-secret' });
    const token = refreshJwt.sign({ sub: user.id, sid: 's-revoked' });
    prisma.session.findUnique.mockResolvedValue({
      id: 's-revoked',
      userId: user.id,
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
      refreshTokenHash: await bcrypt.hash(token, 4),
      user,
    });
    await expect(service.refresh({ refreshToken: token })).rejects.toThrow(
      UnauthorizedException,
    );
  });
});

describe('AuthService.deleteAccount', () => {
  it('rejects a missing or wrong password', async () => {
    const { service, prisma } = await buildService(makePrisma());
    prisma.user.findUnique.mockResolvedValue(
      await verifiedUserWithPassword('real-password'),
    );
    await expect(service.deleteAccount(user.id, '')).rejects.toThrow(
      UnauthorizedException,
    );
    await expect(service.deleteAccount(user.id, 'wrong-password')).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('revokes sessions, wipes related data and anonymizes the user', async () => {
    const { service, prisma } = await buildService(makePrisma());
    prisma.user.findUnique.mockResolvedValue(
      await verifiedUserWithPassword('real-password'),
    );
    const result = await service.deleteAccount(user.id, 'real-password');
    expect(result.success).toBe(true);
    expect(prisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: user.id } }),
    );
    for (const model of [
      prisma.pushToken,
      prisma.notificationLog,
      prisma.profile,
      prisma.notificationPreference,
    ]) {
      expect(model.deleteMany).toHaveBeenCalled();
    }
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: user.id },
        data: expect.objectContaining({ deletedAt: expect.any(Date) }),
      }),
    );
  });
});

describe('AuthService.register', () => {
  it('rejects a duplicate email or username', async () => {
    const { service, prisma } = await buildService(makePrisma());
    prisma.user.findFirst.mockResolvedValue({ id: 'u2', email: 'user@test.dev' });
    await expect(
      service.register({ email: 'user@test.dev', username: 'user', password: 'pw123456789' }),
    ).rejects.toThrow(ConflictException);
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.emailOtp.create).not.toHaveBeenCalled();
  });

  it('creates the user with profile and preferences, then issues an OTP', async () => {
    const { service, prisma } = await buildService(makePrisma());
    prisma.user.findFirst.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: 'u-new', email: 'user@test.dev', username: 'user' });
    const result = await service.register({
      email: 'User@Test.dev',
      username: 'user',
      password: 'pw123456789',
    });
    expect(result).toEqual({ verificationRequired: true, email: 'user@test.dev' });
    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'user@test.dev',
          username: 'user',
          profile: { create: {} },
          notificationPreferences: { create: {} },
        }),
      }),
    );
    expect(prisma.emailOtp.create).toHaveBeenCalledTimes(1);
  });
});

describe('AuthService.resendVerification', () => {
  it('issues a new OTP for an unverified user', async () => {
    const { service, prisma } = await buildService(makePrisma());
    prisma.user.findUnique.mockResolvedValue({ ...user, emailVerifiedAt: null });
    const result = await service.resendVerification('user@test.dev');
    expect(result).toEqual({ sent: true });
    expect(prisma.emailOtp.create).toHaveBeenCalledTimes(1);
    expect(prisma.emailOtp.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: user.id, consumedAt: null } }),
    );
  });

  it('stays silent for unknown or already-verified users', async () => {
    const { service, prisma } = await buildService(makePrisma());
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.resendVerification('nobody@test.dev')).resolves.toEqual({ sent: true });
    prisma.user.findUnique.mockResolvedValue(user);
    await expect(service.resendVerification('user@test.dev')).resolves.toEqual({ sent: true });
    expect(prisma.emailOtp.create).not.toHaveBeenCalled();
  });
});

describe('AuthService.logout', () => {
  it('revokes all active sessions for the user', async () => {
    const { service, prisma } = await buildService(makePrisma());
    const result = await service.logout(user.id);
    expect(result).toEqual({ success: true });
    expect(prisma.session.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      }),
    );
  });
});
