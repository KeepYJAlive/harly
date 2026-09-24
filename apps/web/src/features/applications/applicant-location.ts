import "server-only";

import locations from "countries-states-cities";

export type ApplicantLocation = {
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
};

export type ApplicantLocationIssue = {
  field: "countryCode" | "region" | "city";
  message: string;
};

export type LocationOption = { code: string; name: string };

export function listCountries(): LocationOption[] {
  return locations
    .getAllCountries()
    .map((country) => ({ code: country.iso2, name: country.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listRegions(countryCode: string): LocationOption[] {
  const country = locations
    .getAllCountries()
    .find((entry) => entry.iso2 === countryCode.toUpperCase());
  if (!country) return [];
  return locations
    .getStatesOfCountry(country.id)
    .map((state) => ({ code: state.state_code, name: state.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function listCities(countryCode: string, region?: string): string[] {
  const country = locations
    .getAllCountries()
    .find((entry) => entry.iso2 === countryCode.toUpperCase());
  if (!country) return [];
  const state = locations
    .getStatesOfCountry(country.id)
    .find((entry) => entry.name === region);
  if (!state) return [];
  return Array.from(
    new Set(locations.getCitiesOfState(state.id).map((city) => city.name)),
  ).sort((a, b) => a.localeCompare(b));
}

export function validateApplicantLocation(
  location: ApplicantLocation,
): ApplicantLocationIssue | null {
  const countryCode = location.countryCode?.trim().toUpperCase() ?? "";
  const region = location.region?.trim() ?? "";
  const city = location.city?.trim() ?? "";
  const country = locations
    .getAllCountries()
    .find((entry) => entry.iso2 === countryCode);

  if (!country) {
    return { field: "countryCode", message: "Choose a valid country." };
  }

  const states = locations.getStatesOfCountry(country.id);
  const selectedState = states.find((state) => state.name === region);
  if (states.length > 0 && !selectedState) {
    return {
      field: "region",
      message: "Choose a valid state or province for the selected country.",
    };
  }

  const cities = selectedState
    ? locations.getCitiesOfState(selectedState.id)
    : [];
  if (
    !city ||
    (cities.length > 0 && !cities.some((entry) => entry.name === city))
  ) {
    return {
      field: "city",
      message: "Choose a valid city for the selected state or province.",
    };
  }

  return null;
}

export function formatApplicantLocation(location: ApplicantLocation) {
  const country = location.countryCode
    ? locations
        .getAllCountries()
        .find((entry) => entry.iso2 === location.countryCode?.toUpperCase())
        ?.name
    : undefined;
  return [location.city, location.region, country]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(", ");
}
