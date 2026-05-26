import { describe, expect, it } from "vitest";

import { match_queries, query_match_data } from "../src/query.js";

describe("query helpers", () => {
  it("matches data with mingo queries", () => {
    expect(query_match_data({ age: { $gt: 4 } }, { age: 5 })).toBe(true);
    expect(query_match_data({ age: { $gt: 4 } }, { age: 3 })).toBe(false);
  });

  it("compares exact queries", () => {
    expect(match_queries({ type: "tweet" }, { type: "tweet" })).toBe(1);
    expect(match_queries({ type: "tweet" }, { type: "post" })).toBe(0);
  });

  it("lowers relevancy for broader matches", () => {
    expect(match_queries({ age: { $gt: 4 } }, { age: 6 })).toBe(0.5);
    expect(match_queries({ type: "tweet" }, { type: "tweet", region: "ca" })).toBe(0.5);
  });
});
