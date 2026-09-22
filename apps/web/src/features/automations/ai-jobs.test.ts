import { describe, expect, it } from "vitest";

import {
  computeJobBackoffMs,
  enqueueAutomationAiJob,
  getAutomationAiJob,
  getAutomationJob,
  queueAutomationSimulation,
} from "./ai-jobs";

describe("durable automation job backoff", () => {
  it("backs off exponentially and caps at 60s", () => {
    expect(computeJobBackoffMs(1)).toBe(2_000);
    expect(computeJobBackoffMs(2)).toBe(4_000);
    expect(computeJobBackoffMs(3)).toBe(8_000);
    expect(computeJobBackoffMs(5)).toBe(32_000);
    expect(computeJobBackoffMs(6)).toBe(60_000);
    expect(computeJobBackoffMs(8)).toBe(60_000);
    expect(computeJobBackoffMs(100)).toBe(60_000);
  });

  it("clamps non-positive attempt counts to the first backoff step", () => {
    expect(computeJobBackoffMs(0)).toBe(2_000);
    expect(computeJobBackoffMs(-3)).toBe(2_000);
  });
});

describe("durable automation job aliases", () => {
  it("exposes the tool-facing names for the same service functions", () => {
    expect(queueAutomationSimulation).toBe(enqueueAutomationAiJob);
    expect(getAutomationJob).toBe(getAutomationAiJob);
  });
});
