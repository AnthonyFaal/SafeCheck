import { ServiceUnavailableException } from '@nestjs/common';
import { InferenceClient } from './inference.client';

describe('InferenceClient', () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.INFERENCE_URL;

  beforeEach(() => { process.env.INFERENCE_URL = 'http://inference.test'; });
  afterEach(() => { global.fetch = originalFetch; process.env.INFERENCE_URL = originalUrl; });

  it('forwards a valid model prediction', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(JSON.stringify({ decision: 'SCAM', probability: 0.9, expert_scores: { semantic: 0.9, behavior: 0.9, character: 0.9 } }), { status: 200 }));
    await expect(new InferenceClient().predict('suspicious message')).resolves.toMatchObject({ decision: 'SCAM', probability: 0.9 });
  });

  it('does not expose inference failures to callers', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network unavailable'));
    await expect(new InferenceClient().predict('suspicious message')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
