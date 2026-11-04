import {
  BadRequestException,
  Controller,
  Headers,
  Injectable,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { ProductService } from './product';
import { PrismaService } from './prisma.service';

type PaystackEvent = {
  event: string;
  data?: {
    status?: string;
    reference?: string;
    metadata?: { userId?: string; plan?: string };
  };
};

@Injectable()
export class PaystackWebhookService {
  constructor(private readonly product: ProductService, private readonly prisma: PrismaService) {}

  verifySignature(rawBody: Buffer, signature: string | undefined) {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) throw new BadRequestException('Paystack is not configured');
    if (!signature) throw new UnauthorizedException('Missing Paystack signature');
    const hash = createHmac('sha512', secret).update(rawBody).digest('hex');
    if (hash !== signature) throw new UnauthorizedException('Invalid Paystack signature');
  }

  async handleEvent(event: PaystackEvent) {
    if (event.event !== 'charge.success') return { received: true, handled: false };
    const reference = event.data?.reference;
    const userId = event.data?.metadata?.userId;
    if (!reference || !userId || event.data?.status !== 'success' || event.data.metadata?.plan !== 'PREMIUM') {
      return { received: true, handled: false };
    }
    const existing = await this.prisma.subscription.findUnique({
      where: { providerReference: reference },
      select: { userId: true, plan: true, status: true },
    });
    // Paystack may retry a delivered event. Returning 200 for the same completed
    // reference prevents duplicate processing while still acknowledging the retry.
    if (existing?.userId === userId && existing.plan === 'PREMIUM' && existing.status === 'ACTIVE') {
      return { received: true, handled: true, duplicate: true };
    }
    await this.product.activatePremium(userId, reference);
    return { received: true, handled: true, duplicate: false };
  }
}

@Controller('webhooks/paystack')
export class PaystackWebhookController {
  constructor(private readonly webhooks: PaystackWebhookService) {}

  @Post()
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-paystack-signature') signature: string | undefined,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody?.length) throw new BadRequestException('Webhook body is required');
    this.webhooks.verifySignature(rawBody, signature);
    const event = JSON.parse(rawBody.toString('utf8')) as PaystackEvent;
    return this.webhooks.handleEvent(event);
  }
}
