import { describe, expect, it } from "vitest";

import { taoDeliveryIdSchema } from "./validation";

describe("TAO delivery ID validation", () => {
  it("accepts the verified TAO delivery identifier", () => {
    expect(taoDeliveryIdSchema.parse("9ddca443197e")).toBe("9ddca443197e");
  });

  it.each([
    "https://assessment.example/delivery/one",
    "delivery/one",
    "delivery?one",
    "delivery#one",
    "../delivery",
    "delivery one",
  ])("rejects a URL or unsafe path value: %s", (value) => {
    expect(taoDeliveryIdSchema.safeParse(value).success).toBe(false);
  });
});
