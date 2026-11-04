import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

export type InferenceDecision = 'HAM' | 'REVIEW' | 'SCAM';
export type InferenceResult = {
  decision: InferenceDecision;
  probability: number;
  expert_scores: { semantic: number; behavior: number; character: number };
};

@Injectable()
export class InferenceClient {
  private readonly logger = new Logger(InferenceClient.name);
  private readonly baseUrl = process.env.INFERENCE_URL?.replace(/\/$/, '');
  private readonly timeoutMs = Number(process.env.INFERENCE_TIMEOUT_MS ?? 8_000);

  async predict(text: string): Promise<InferenceResult> {
    if (!this.baseUrl) throw new ServiceUnavailableException('Safety analysis is not configured');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}/v1/predict`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(process.env.INFERENCE_API_KEY ? { 'X-Inference-Key': process.env.INFERENCE_API_KEY } : {}),
        },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn(`Inference service returned ${response.status}`);
        throw new ServiceUnavailableException('Safety analysis is temporarily unavailable');
      }
      const result = await response.json() as InferenceResult;
      if (!['HAM', 'REVIEW', 'SCAM'].includes(result.decision) || !Number.isFinite(result.probability)) {
        this.logger.error('Inference service returned an invalid response');
        throw new ServiceUnavailableException('Safety analysis is temporarily unavailable');
      }
      return result;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error('Inference request failed', error instanceof Error ? error.stack : undefined);
      throw new ServiceUnavailableException('Safety analysis is temporarily unavailable');
    } finally {
      clearTimeout(timeout);
    }
  }
}
