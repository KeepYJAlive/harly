"use server";

import {
  listCities,
  listCountries,
  listRegions,
} from "./applicant-location";

export async function getCountries() {
  return listCountries();
}

export async function getRegions(countryCode: string) {
  return listRegions(countryCode);
}

export async function getCities(countryCode: string, region?: string) {
  return listCities(countryCode, region);
}
