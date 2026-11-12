import { AiResult } from './ai.types';

/**
 * Result of `AiService.stream()`: iterate it for the text deltas; `result`
 * resolves with the full text, model and usage once the stream ends (or
 * rejects with the error that ended it). `text` holds what arrived so far,
 * e.g. to save a partial answer after an error.
 *
 *   const stream = ai.stream('Tell a joke');
 *   for await (const delta of stream) res.write(delta);
 *   const { usage } = await stream.result;
 *
 * Breaking out of the loop cancels the provider request. A stream can be read once.
 */
export class AiStream implements AsyncIterable<string> {
  readonly result: Promise<AiResult>;
  private resolveResult!: (result: AiResult) => void;
  private rejectResult!: (error: unknown) => void;
  private started = false;
  private collected = '';

  constructor(private readonly source: AsyncGenerator<string, AiResult>) {
    this.result = new Promise<AiResult>((resolve, reject) => {
      this.resolveResult = resolve;
      this.rejectResult = reject;
    });
    // Nobody has to await `result`; an unobserved rejection must not crash the process.
    void this.result.catch(() => undefined);
  }

  /** Text received so far. */
  get text(): string {
    return this.collected;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    if (this.started) throw new Error('An AiStream can be read only once');
    this.started = true;
    let settled = false;
    try {
      for (;;) {
        const next = await this.source.next();
        if (next.done) {
          settled = true;
          this.resolveResult(next.value);
          return;
        }
        this.collected += next.value;
        yield next.value;
      }
    } catch (error) {
      settled = true;
      this.rejectResult(error);
      throw error;
    } finally {
      if (!settled) {
        // The consumer stopped early: close the source (aborts the HTTP request).
        await this.source.return(undefined as unknown as AiResult).catch(() => undefined);
        this.rejectResult(new Error('Stream closed before the end'));
      }
    }
  }
}
