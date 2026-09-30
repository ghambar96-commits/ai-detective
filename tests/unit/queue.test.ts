/**
 * Unit tests — in-memory job queue (queue/job-queue.ts).
 * FIFO order, concurrency limit, stats counters, processor attachment.
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { getJobQueue } from "@/lib/aidetective/queue/job-queue";

function wait(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe("job queue", () => {
  const queue = getJobQueue();

  beforeEach(() => {
    queue.setProcessor(async () => {});
  });

  test("singleton via globalThis", () => {
    expect(getJobQueue()).toBe(queue);
  });

  test("stats shape is complete and honest", () => {
    const s = queue.stats();
    expect(s.implementation).toBe("in_memory");
    expect(s.concurrency).toBeGreaterThanOrEqual(1);
    expect(typeof s.queued).toBe("number");
    expect(typeof s.active).toBe("number");
    expect(typeof s.processed).toBe("number");
    expect(typeof s.failed).toBe("number");
  });

  test("processes jobs FIFO with concurrency 1 ordering", async () => {
    const processed: string[] = [];
    let release: (() => void) | null = null;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    queue.setProcessor(async (id) => {
      processed.push(id);
      if (processed.length === 1) await gate; // block the single worker
    });

    queue.enqueue("a");
    queue.enqueue("b");
    queue.enqueue("c");
    await wait(50);
    expect(processed).toEqual(["a"]); // worker busy with first job, queue holds rest
    expect(queue.stats().active).toBe(1);
    expect(queue.stats().queued).toBe(2);

    release!();
    await wait(80);
    expect(processed).toEqual(["a", "b", "c"]);
    expect(queue.stats().queued).toBe(0);
    expect(queue.stats().active).toBe(0);
  });

  test("processor crash is contained and counted as failed", async () => {
    queue.setProcessor(async (id) => {
      if (id === "boom") throw new Error("intentional crash");
    });
    queue.enqueue("boom");
    queue.enqueue("ok-after-crash");
    await wait(80);
    expect(queue.stats().failed).toBeGreaterThanOrEqual(1);
    expect(queue.stats().active).toBe(0);
  });

  test("re-attaching processor resumes work (HMR-safety path)", async () => {
    const processed: string[] = [];
    queue.setProcessor(async (id) => {
      processed.push(id);
    });
    queue.enqueue("after-reattach");
    await wait(60);
    expect(processed).toContain("after-reattach");
  });
});
