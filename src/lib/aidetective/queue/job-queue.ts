/**
 * AIDetective — background job queue (local-first MVP).
 *
 * Simplest reliable in-process implementation:
 *  - FIFO queue of analysis ids, N workers (configurable concurrency).
 *  - Survives Next.js HMR via globalThis singleton.
 *  - Jobs are persisted in the DB *before* enqueueing, so a crash only loses
 *    in-flight work, never history.
 *
 * The interface is deliberately narrow so a Redis + distributed worker pool
 * (phase 3) can replace this class without touching the analysis engine.
 */
import { createLogger } from "../core/logger";
import { config } from "../core/config";

const log = createLogger("queue");

export interface QueueStats {
  implementation: "in_memory";
  queued: number;
  active: number;
  concurrency: number;
  processed: number;
  failed: number;
}

export interface JobQueue {
  enqueue(analysisId: string): void;
  stats(): QueueStats;
}

type JobProcessor = (analysisId: string) => Promise<void>;

class InMemoryJobQueue implements JobQueue {
  private queue: string[] = [];
  private active = 0;
  private processed = 0;
  private failed = 0;
  private processor: JobProcessor | null = null;
  private readonly concurrency: number;

  constructor(concurrency: number) {
    this.concurrency = Math.max(1, concurrency);
  }

  setProcessor(processor: JobProcessor) {
    this.processor = processor;
    // Drain anything enqueued before a processor was attached (HMR edge case).
    for (let i = 0; i < this.concurrency; i++) void this.tick();
  }

  enqueue(analysisId: string) {
    this.queue.push(analysisId);
    log.debug("job enqueued", { analysisId, depth: this.queue.length });
    void this.tick();
  }

  stats(): QueueStats {
    return {
      implementation: "in_memory",
      queued: this.queue.length,
      active: this.active,
      concurrency: this.concurrency,
      processed: this.processed,
      failed: this.failed,
    };
  }

  private async tick() {
    if (this.active >= this.concurrency || !this.processor) return;
    const id = this.queue.shift();
    if (!id) return;
    this.active++;
    try {
      await this.processor(id);
      this.processed++;
    } catch (error) {
      this.failed++;
      // The orchestrator is responsible for marking the analysis failed;
      // this catch is a last-resort safety net.
      log.error("job crashed outside orchestrator handling", {
        analysisId: id,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.active--;
      void this.tick();
    }
  }
}

export function getJobQueue(): InMemoryJobQueue {
  const g = globalThis as unknown as { __aidetectiveQueue?: InMemoryJobQueue };
  if (!g.__aidetectiveQueue) {
    g.__aidetectiveQueue = new InMemoryJobQueue(config.queue.concurrency);
    log.info("job queue initialized", { concurrency: config.queue.concurrency });
  }
  return g.__aidetectiveQueue;
}
