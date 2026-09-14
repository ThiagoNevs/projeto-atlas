import { inspect } from 'node:util';

const REDACTED_SECRET = '[REDACTED_SECRET]';

export class ResolvedSecret {
  readonly #value: string;

  private constructor(value: string) {
    this.#value = value;
    Object.freeze(this);
  }

  static from(value: string): ResolvedSecret {
    return new ResolvedSecret(value);
  }

  use<TResult>(consumer: (value: string) => Promise<TResult>): Promise<TResult>;
  use<TResult>(consumer: (value: string) => TResult): TResult;
  use<TResult>(
    consumer: (value: string) => TResult | Promise<TResult>,
  ): TResult | Promise<TResult> {
    return consumer(this.#value);
  }

  toString(): string {
    return REDACTED_SECRET;
  }

  toJSON(): string {
    return REDACTED_SECRET;
  }

  [inspect.custom](): string {
    return REDACTED_SECRET;
  }
}
