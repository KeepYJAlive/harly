"use client";

import { useEffect, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

import {
  getCities,
  getCountries,
  getRegions,
  getTimeZones,
} from "./location-actions";

type LocationOption = { code: string; name: string };

function SearchableLocationSelect({
  name,
  value,
  options,
  placeholder,
  inputClassName,
  optionValue = "code",
  required = false,
  disabled = false,
  onChange,
}: {
  name: string;
  value: string;
  options: LocationOption[] | string[];
  placeholder: string;
  inputClassName: string;
  optionValue?: "code" | "name";
  required?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const normalizedOptions = options.map((option) =>
    typeof option === "string"
      ? { value: option, label: option }
      : {
          value: optionValue === "name" ? option.name : option.code,
          label: option.name,
        },
  );
  const selected = normalizedOptions.find((option) => option.value === value);

  return (
    <>
      <input type="hidden" name={name} value={value} required={required} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              inputClassName,
              "mt-1 w-full justify-between px-3 text-left font-normal",
            )}
          >
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected?.label ?? placeholder}
            </span>
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-(--radix-popover-trigger-width) p-0"
        >
          <Command>
            <CommandInput placeholder={`Search ${name === "countryCode" ? "countries" : name === "region" ? "states / provinces" : "cities"}...`} />
            <CommandList>
              <CommandEmpty>No matches found.</CommandEmpty>
              <CommandGroup>
                {normalizedOptions.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    onSelect={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <Check
                      className={cn(
                        "size-4",
                        value === option.value ? "opacity-100" : "opacity-0",
                      )}
                    />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </>
  );
}

export function ApplicantLocationFields({
  inputClassName,
  className,
  errors,
}: {
  inputClassName: string;
  className?: string;
  errors?: Partial<Record<"countryCode" | "region" | "city", string[]>>;
}) {
  const [countries, setCountries] = useState<LocationOption[]>([]);
  const [regions, setRegions] = useState<LocationOption[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [timeZoneOptions, setTimeZoneOptions] = useState<string[]>([]);
  const [countryCode, setCountryCode] = useState("");
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [timeZone, setTimeZone] = useState("");
  const [timeZoneChanged, setTimeZoneChanged] = useState(false);
  const [regionsLoaded, setRegionsLoaded] = useState(false);
  const [citiesLoaded, setCitiesLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void getCountries().then((values) => {
      if (active) setCountries(values);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setRegionsLoaded(false);
    if (!countryCode) {
      setRegions([]);
      setRegionsLoaded(true);
      return;
    }
    void getRegions(countryCode).then((values) => {
      if (active) {
        setRegions(values);
        setRegionsLoaded(true);
      }
    });
    return () => {
      active = false;
    };
  }, [countryCode]);

  useEffect(() => {
    let active = true;
    setCitiesLoaded(false);
    if (
      !countryCode ||
      !regionsLoaded ||
      (regions.length > 0 && !region)
    ) {
      setCities([]);
      return;
    }
    void getCities(countryCode, region || undefined).then((values) => {
      if (active) {
        setCities(values);
        setCitiesLoaded(true);
      }
    });
    return () => {
      active = false;
    };
  }, [countryCode, region, regions.length, regionsLoaded]);

  useEffect(() => {
    let active = true;
    if (
      !timeZoneChanged &&
      countryCode &&
      regionsLoaded &&
      (regions.length === 0 || region) &&
      citiesLoaded
    ) {
      void getTimeZones(countryCode).then((values) => {
        if (active) {
          setTimeZoneOptions(values.length > 0 ? values : ["UTC"]);
          if (!timeZoneChanged) setTimeZone(values[0] ?? "UTC");
        }
      });
    }
    return () => {
      active = false;
    };
  }, [countryCode, region, regions.length, regionsLoaded, citiesLoaded, timeZoneChanged]);

  const countryName = countries.find(
    (country) => country.code === countryCode,
  )?.name;
  const address = [city, region, countryName].filter(Boolean).join(", ");

  return (
    <fieldset className={className}>
      <legend className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
        Location <span className="text-red-500">*</span>
      </legend>
      <input type="hidden" name="address" value={address} />
      <div className="mt-1.5 grid gap-3 sm:grid-cols-3">
        <label>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Country
          </span>
          <SearchableLocationSelect
            name="countryCode"
            value={countryCode}
            options={countries}
            placeholder="Select country"
            inputClassName={inputClassName}
            required
            onChange={(value) => {
              setCountryCode(value);
              setRegion("");
              setCity("");
              setTimeZoneOptions([]);
              setTimeZone("");
              setTimeZoneChanged(false);
            }}
          />
          {errors?.countryCode?.[0] ? (
            <span className="mt-1.5 block text-xs font-medium text-red-600">
              {errors.countryCode[0]}
            </span>
          ) : null}
        </label>

        <label hidden={!countryCode || !regionsLoaded || regions.length === 0}>
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            State / province
          </span>
          <SearchableLocationSelect
            name="region"
            value={region}
            options={regions}
            placeholder="Select state / province"
            inputClassName={inputClassName}
            optionValue="name"
            required={regions.length > 0}
            disabled={!countryCode || !regionsLoaded || regions.length === 0}
            onChange={(value) => {
              setRegion(value);
              setCity("");
              setTimeZoneOptions([]);
              setTimeZone("");
              setTimeZoneChanged(false);
            }}
          />
          {errors?.region?.[0] ? (
            <span className="mt-1.5 block text-xs font-medium text-red-600">
              {errors.region[0]}
            </span>
          ) : null}
        </label>

        <label
          hidden={
            !countryCode ||
            !regionsLoaded ||
            (regions.length > 0 && !region) ||
            !citiesLoaded
          }
        >
          <span className="text-xs text-zinc-500 dark:text-zinc-400">City</span>
          {citiesLoaded && cities.length === 0 ? (
            <input
              id="city"
              name="city"
              value={city}
              onChange={(event) => setCity(event.target.value)}
              className={`${inputClassName} mt-1`}
              placeholder="Enter city"
              required
            />
          ) : (
            <SearchableLocationSelect
              name="city"
              value={city}
              options={cities}
              placeholder="Select city"
              inputClassName={inputClassName}
              required
              onChange={setCity}
            />
          )}
          {errors?.city?.[0] ? (
            <span className="mt-1.5 block text-xs font-medium text-red-600">
              {errors.city[0]}
            </span>
          ) : null}
        </label>

        <label
          hidden={
            !countryCode ||
            !regionsLoaded ||
            (regions.length > 0 && !region) ||
            !citiesLoaded
          }
        >
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            Preferred timezone location
          </span>
          <SearchableLocationSelect
            name="timezone"
            value={timeZone}
            options={timeZoneOptions}
            placeholder="Select preferred timezone"
            inputClassName={inputClassName}
            required
            disabled={!countryCode || !regionsLoaded || !citiesLoaded}
            onChange={(value) => {
              setTimeZone(value);
              setTimeZoneChanged(true);
            }}
          />
        </label>
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        Select your location so the volunteer team has accurate regional information.
      </p>
    </fieldset>
  );
}
