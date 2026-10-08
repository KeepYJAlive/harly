import { z } from "zod";
import { canEncodeRemoteListId } from "./identifiers";

export const listKey = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]{0,99}$/,
    "Use a lowercase key starting with a letter (letters, digits, underscores; max 100).",
  );
export const entrySchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(200)
      .refine(
        canEncodeRemoteListId,
        "ID must encode to a valid TAO URI of at most 255 characters.",
      )
      .refine(
        (s) => s === s.trim() && !/[\u0000-\u001f\u007f]/.test(s),
        "IDs must not have surrounding whitespace or control characters.",
      ),
    label: z.string().trim().min(1).max(500),
    enabled: z.boolean().default(true),
  })
  .strict();
export const importSchema = z
  .object({
    key: listKey,
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(4000).default(""),
    values: z.array(entrySchema).max(10000),
  })
  .strict()
  .superRefine((data, ctx) => {
    const ids = new Set<string>();
    const labels = new Set<string>();
    data.values.forEach((value, i) => {
      if (ids.has(value.id))
        ctx.addIssue({
          code: "custom",
          path: ["values", i, "id"],
          message: `Duplicate ID: ${value.id}`,
        });
      const label = value.label.normalize("NFKC").toLowerCase();
      if (labels.has(label))
        ctx.addIssue({
          code: "custom",
          path: ["values", i, "label"],
          message: `Duplicate label: ${value.label}`,
        });
      ids.add(value.id);
      labels.add(label);
    });
  });
export type Vocabulary = z.infer<typeof importSchema>;
export type Entry = Vocabulary["values"][number];

export function parseImport(json: string): Vocabulary {
  if (
    typeof json !== "string" ||
    new TextEncoder().encode(json).length > 500_000
  )
    throw new Error("JSON must be at most 500 KB.");
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error("Malformed JSON.");
  }
  const parsed = importSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .slice(0, 10)
        .join("\n"),
    );
  return parsed.data;
}

export function previewImport(incoming: Vocabulary, existing: Entry[]) {
  const previous = new Map(existing.map((entry) => [entry.id, entry]));
  const next = new Set(incoming.values.map((entry) => entry.id));
  const additions = incoming.values.filter((entry) => !previous.has(entry.id));
  const changes = incoming.values
    .filter((entry) => {
      const old = previous.get(entry.id);
      return (
        old && (old.label !== entry.label || old.enabled !== entry.enabled)
      );
    })
    .map((entry) => ({ before: previous.get(entry.id)!, after: entry }));
  const unchanged = incoming.values.filter((entry) => {
    const old = previous.get(entry.id);
    return old && old.label === entry.label && old.enabled === entry.enabled;
  });
  const removed = existing.filter((entry) => !next.has(entry.id));
  // Missing values are retained, including when someone accidentally renames an ID.
  // Validate the merged set too: incoming labels may collide with retained values.
  const merged = importSchema.parse({
    ...incoming,
    values: [...incoming.values, ...removed],
  });
  return { additions, changes, unchanged, removed, values: merged.values };
}
