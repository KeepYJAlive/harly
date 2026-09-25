import { describe, expect, it } from "vitest";

import {
  listCities,
  listRegions,
  validateApplicantLocation,
} from "./applicant-location";

describe("volunteer applicant locations", () => {
  it("returns subdivisions and cities for a selected country", () => {
    expect(listRegions("US")).toContainEqual({
      code: "CA",
      name: "California",
    });
    expect(listCities("US", "California")).toContain("San Francisco");
  });

  it("rejects a city outside the selected subdivision", () => {
    expect(
      validateApplicantLocation({
        countryCode: "US",
        region: "California",
        city: "Toronto",
      }),
    ).toEqual({
      field: "city",
      message: "Choose a valid city for the selected state or province.",
    });
  });
});
