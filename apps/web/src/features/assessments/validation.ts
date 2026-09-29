import { z } from "zod";

/**
 * TAO delivery IDs become a single trusted URL path segment. Keep validation
 * deliberately format-agnostic beyond RFC 3986 unreserved characters so a
 * future supported TAO identifier is not mistaken for a URL or path.
 */
export const taoDeliveryIdSchema = z
  .string()
  .trim()
  .min(1, "TAO delivery ID is required.")
  .max(255, "TAO delivery ID is too long.")
  .regex(
    /^[A-Za-z0-9._~-]+$/,
    "TAO delivery ID must be a single safe identifier, not a URL or path.",
  );
