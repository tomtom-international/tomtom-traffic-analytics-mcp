import { describe, it, expect } from "vitest";
import { dedupeBy } from "./collections";

describe("dedupeBy", () => {
  it("keeps the first occurrence and preserves order", () => {
    const items = [
      { id: "a", v: 1 },
      { id: "b", v: 2 },
      { id: "a", v: 3 },
      { id: "c", v: 4 },
    ];
    expect(dedupeBy(items, (i) => i.id)).toEqual([
      { id: "a", v: 1 },
      { id: "b", v: 2 },
      { id: "c", v: 4 },
    ]);
  });
  it("returns an empty array unchanged", () => {
    expect(dedupeBy([], () => "x")).toEqual([]);
  });
  it("passes through when all keys are unique", () => {
    const items = [{ id: "a" }, { id: "b" }];
    expect(dedupeBy(items, (i) => i.id)).toEqual(items);
  });
});
