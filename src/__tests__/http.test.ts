import { describe, expect, test } from "vitest";

import {
  DEFAULT_ORIGIN,
  requestOrigin,
  wantsJson,
  wantsMarkdown,
} from "../lib/http.js";

describe(requestOrigin, () => {
  test("uses the request host for the production and local hosts", () => {
    expect(
      requestOrigin({
        headers: {
          host: "x-lookup.mynameistito.com",
          "x-forwarded-proto": "https",
        },
      })
    ).toBe("https://x-lookup.mynameistito.com");
    expect(
      requestOrigin({
        headers: { host: "localhost:8787" },
        protocol: "http",
      })
    ).toBe("http://localhost:8787");
    expect(
      requestOrigin({
        headers: { host: "127.0.0.1:8787" },
        protocol: "http",
      })
    ).toBe("http://127.0.0.1:8787");
  });

  test("ignores a forged forwarded host", () => {
    expect(
      requestOrigin({
        headers: {
          host: "x-lookup.mynameistito.com",
          "x-forwarded-host": "evil.example",
        },
      })
    ).toBe("https://x-lookup.mynameistito.com");
  });

  test("falls back to the hosted origin for unknown hosts", () => {
    expect(requestOrigin({ headers: {} })).toBe(DEFAULT_ORIGIN);
    expect(requestOrigin({ headers: { host: "evil.example" } })).toBe(
      DEFAULT_ORIGIN
    );
  });
});

describe(wantsMarkdown, () => {
  test("gives an explicit format precedence over Accept", () => {
    expect(wantsMarkdown("json", "text/markdown")).toBeFalsy();
    expect(wantsMarkdown("markdown", "application/json")).toBeTruthy();
  });

  test("uses Accept when no format is explicit", () => {
    expect(wantsMarkdown(undefined, "text/markdown")).toBeTruthy();
    expect(wantsMarkdown(undefined, "text/html")).toBeFalsy();
  });
});

describe(wantsJson, () => {
  test("gives an explicit format precedence over Accept", () => {
    expect(wantsJson("markdown", "application/json")).toBeFalsy();
    expect(wantsJson("json", "text/markdown")).toBeTruthy();
  });

  test("uses Accept when no format is explicit", () => {
    expect(wantsJson(undefined, "application/json")).toBeTruthy();
    expect(wantsJson(undefined, "text/markdown")).toBeFalsy();
  });
});
