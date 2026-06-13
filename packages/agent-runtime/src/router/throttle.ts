/**
 * ThrottledRouterClient (Phase 5.5) — bungkus RouterClient untuk membatasi BEBAN ke 9Router:
 *  - `maxConcurrency`: jumlah panggilan chat yang berjalan bersamaan (lindungi router lokal,
 *    hindari lonjakan saat banyak step/agent jalan paralel).
 *  - `minIntervalMs`: jarak minimum antar-AWAL panggilan (rate-limit halus).
 *
 * Antrian FIFO; tak mengubah perilaku/hasil panggilan — hanya menunda mulainya. `schedule`/`now`
 * dapat di-inject untuk test deterministik (default `setTimeout`/`Date.now`).
 */

import type { ChatRequest, ChatResponse, RouterClient } from "@vc/shared";

export interface ThrottleOptions {
  /** Maks panggilan chat bersamaan. Default 4. */
  maxConcurrency?: number;
  /** Jarak minimum (ms) antar-awal panggilan. Default 0 (nonaktif). */
  minIntervalMs?: number;
  now?: () => number;
  schedule?: (cb: () => void, ms: number) => void;
}

interface Job {
  req: ChatRequest;
  resolve: (r: ChatResponse) => void;
  reject: (e: unknown) => void;
}

export class ThrottledRouterClient implements RouterClient {
  private readonly inner: RouterClient;
  private readonly maxConcurrency: number;
  private readonly minIntervalMs: number;
  private readonly now: () => number;
  private readonly schedule: (cb: () => void, ms: number) => void;

  private readonly queue: Job[] = [];
  private active = 0;
  private lastStartAt = 0;
  private timerScheduled = false;

  constructor(inner: RouterClient, opts: ThrottleOptions = {}) {
    this.inner = inner;
    this.maxConcurrency = Math.max(1, opts.maxConcurrency ?? 4);
    this.minIntervalMs = Math.max(0, opts.minIntervalMs ?? 0);
    this.now = opts.now ?? Date.now;
    this.schedule = opts.schedule ?? ((cb, ms) => void setTimeout(cb, ms));
  }

  chat(req: ChatRequest): Promise<ChatResponse> {
    return new Promise<ChatResponse>((resolve, reject) => {
      this.queue.push({ req, resolve, reject });
      this.pump();
    });
  }

  private pump(): void {
    while (this.active < this.maxConcurrency && this.queue.length > 0) {
      if (this.minIntervalMs > 0) {
        const wait = this.lastStartAt + this.minIntervalMs - this.now();
        if (wait > 0) {
          if (!this.timerScheduled) {
            this.timerScheduled = true;
            this.schedule(() => {
              this.timerScheduled = false;
              this.pump();
            }, wait);
          }
          return;
        }
      }
      const job = this.queue.shift()!;
      this.active += 1;
      this.lastStartAt = this.now();
      this.inner
        .chat(job.req)
        .then(job.resolve, job.reject)
        .finally(() => {
          this.active -= 1;
          this.pump();
        });
    }
  }
}
