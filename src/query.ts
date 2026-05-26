import { Query } from "mingo";

import type { QueryRecord } from "./types.js";

function isPlainObject(value: QueryRecord[keyof QueryRecord]): value is QueryRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function testOperator(operator: string, expected: unknown, actual: unknown): boolean {
  return query_match_data(
    {
      value: {
        [operator]: expected,
      },
    },
    { value: actual },
  );
}

function matchSmartQuery(q1: QueryRecord, q2: QueryRecord): number {
  let relevancy = 1;

  for (const [key1, value1] of Object.entries(q1)) {
    for (const [key2, value2] of Object.entries(q2)) {
      const checks: Array<[string, unknown, unknown]> = [
        [key1, value1, value2],
        [key2, value2, value1],
      ];

      const results = checks
        .filter(([operator]) => ["$lt", "$gt", "$ne", "$eq"].includes(operator))
        .map(([operator, expected, actual]) =>
          testOperator(operator, expected, actual),
        );

      if (results[0]) {
        if (results[1]) {
          continue;
        }

        relevancy /= 2;
        continue;
      }

      return 0;
    }
  }

  return relevancy;
}

export function query_match_data(query: QueryRecord, data: QueryRecord): boolean {
  return new Query(query).test(data);
}

export function match_queries(q1: QueryRecord, q2: QueryRecord): number {
  let relevancy = 1;

  for (const [key1, value1] of Object.entries(q1)) {
    const value2 = q2[key1];

    if (value2 === undefined) {
      continue;
    }

    if (isPlainObject(value1)) {
      if (isPlainObject(value2)) {
        relevancy *= matchSmartQuery(value1, value2);
        if (!relevancy) {
          return 0;
        }
        continue;
      }

      if (!query_match_data({ [key1]: value1 }, { [key1]: value2 })) {
        return 0;
      }

      relevancy /= 2;
      continue;
    }

    if (isPlainObject(value2)) {
      if (!query_match_data({ [key1]: value2 }, { [key1]: value1 })) {
        return 0;
      }

      continue;
    }

    if (value1 !== value2) {
      return 0;
    }
  }

  for (const key2 of Object.keys(q2)) {
    if (q1[key2] === undefined) {
      relevancy /= 2;
    }
  }

  return relevancy;
}
