import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Controller('health')
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  status() { return { status: 'ok', service: 'safecheck-api', at: new Date().toISOString() }; }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ready', service: 'safecheck-api' };
    } catch {
      throw new ServiceUnavailableException('Database is unavailable');
    }
  }
}
