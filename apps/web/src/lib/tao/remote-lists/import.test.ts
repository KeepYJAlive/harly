import { describe, expect, it } from "vitest";
import { parseImport, previewImport } from "./import";
import { remoteListEntryUri } from "./identifiers";

const doc = (values: unknown[], key = "topics") =>
  JSON.stringify({ key, name: "Topics", values });
describe("remote vocabulary import", () => {
  it("rejects malformed JSON and bounded input", () => {
    expect(() => parseImport("{")).toThrow("Malformed JSON");
    expect(() => parseImport(" ".repeat(500_001))).toThrow("500 KB");
  });
  it.each([
    [{ id: "", label: "Name" }],
    [{ id: " id", label: "Name" }],
    [{ id: "id", label: " " }],
    [
      { id: "id", label: "First" },
      { id: "id", label: "Second" },
    ],
    [
      { id: "a", label: "Same" },
      { id: "b", label: " same " },
    ],
    [
      { id: "a", label: "Ａ" },
      { id: "b", label: "A" },
    ],
    [{ id: "a", label: "Name", unknown: true }],
  ])("rejects invalid / duplicate values: %j", (...values) => {
    expect(() => parseImport(doc(values))).toThrow();
  });
  it("enforces TAO's 255-character URI limit after encoding", () => {
    expect(() =>
      parseImport(doc([{ id: "a".repeat(200), label: "Too long" }])),
    ).toThrow("255");
    expect(() =>
      parseImport(doc([{ id: "é".repeat(40), label: "Too long encoded" }])),
    ).toThrow("255");
    expect(() =>
      parseImport(doc([{ id: "\ud800", label: "Invalid surrogate" }])),
    ).toThrow("255");
    const id = "é".repeat(20);
    expect(
      parseImport(doc([{ id, label: "Valid Unicode" }])).values[0].id,
    ).toBe(id);
    expect(
      remoteListEntryUri("00000000-0000-4000-8000-000000000000", id).length,
    ).toBeLessThanOrEqual(255);
  });
  it("keeps identities separate from labels and does not silently delete omissions", () => {
    const existing = parseImport(
      doc([
        { id: "a", label: "Old" },
        { id: "b", label: "Retained" },
        { id: "c", label: "Same" },
      ]),
    ).values;
    const incoming = parseImport(
      doc([
        { id: "a", label: "Renamed" },
        { id: "c", label: "Same" },
        { id: "d", label: "New" },
      ]),
    );
    const diff = previewImport(incoming, existing);
    expect(diff.additions.map((v) => v.id)).toEqual(["d"]);
    expect(diff.changes[0]).toMatchObject({
      before: { id: "a", label: "Old" },
      after: { id: "a", label: "Renamed" },
    });
    expect(diff.unchanged.map((v) => v.id)).toEqual(["c"]);
    expect(diff.removed.map((v) => v.id)).toEqual(["b"]);
    expect(diff.values.map((v) => v.id)).toEqual(["a", "c", "d", "b"]);
    expect(previewImport(parseImport(doc([])), existing).values).toEqual(
      existing,
    );
  });
  it("rejects attempted ID renames that collide with retained labels", () => {
    const existing = parseImport(
      doc([{ id: "old", label: "Stable label" }]),
    ).values;
    expect(() =>
      previewImport(
        parseImport(doc([{ id: "new", label: "Stable label" }])),
        existing,
      ),
    ).toThrow();
  });
  it("supports independent vocabularies and round-trip export", () => {
    const input = parseImport(
      doc(
        [{ id: "wally_fate", label: "Wally’s Fate", enabled: false }],
        "kyja_topics",
      ),
    );
    expect(parseImport(JSON.stringify(input))).toEqual(input);
    expect(parseImport(doc(input.values, "other_list")).values).toEqual(
      input.values,
    );
  });
});
