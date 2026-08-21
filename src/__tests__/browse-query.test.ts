import { Result } from "effect";
import { describe, expect, test } from "vitest";

import { parseBrowseRequest } from "@/lib/browse.ts";
import type { BrowseInput, BrowseRequest } from "@/lib/browse.ts";

const succeed = (input: BrowseInput): BrowseRequest => {
  const result = parseBrowseRequest(input);
  if (Result.isFailure(result)) {
    throw new Error(`expected success, got: ${JSON.stringify(result.failure)}`);
  }
  return result.success;
};

const failureOf = (input: BrowseInput) => {
  const result = parseBrowseRequest(input);
  if (Result.isSuccess(result)) {
    throw new Error("expected a typed failure, got success");
  }
  return result.failure;
};

const searchSelection = (request: BrowseRequest) => {
  if (request.selection._tag !== "search") {
    throw new Error(`expected search selection, got ${request.selection._tag}`);
  }
  return request.selection;
};

describe("browse resource parsing", () => {
  test.each([undefined, null, "", "posts", "PROFILE"] as const)(
    "refuses resource=%s with the historical contract",
    (resource) => {
      const failure = failureOf({ handle: "ada", resource });
      expect(failure).toMatchObject({
        _tag: "InvalidBrowseResource",
        code: "invalid_resource",
        message: "Unsupported browse resource.",
        status: 400,
      });
    }
  );

  test.each(["profile", "followers", "following"] as const)(
    "accepts resource=%s with a valid handle",
    (resource) => {
      const result = succeed({ handle: "ada", nocache: true, resource });
      expect(result.selection._tag).toBe(resource);
    }
  );
});

describe("browse search parsing", () => {
  test.each([undefined, null, "", "   "] as const)(
    "refuses empty q values (%s)",
    (q) => {
      const failure = failureOf({ q, resource: "search" });
      expect(failure).toMatchObject({
        _tag: "MissingSearchQuery",
        code: "missing_query",
        message: "Search query q is required.",
        status: 400,
      });
    }
  );

  test("trims the query before searching", () => {
    const selection = searchSelection(
      succeed({ q: "  cloudflare workers  ", resource: "search" })
    );
    expect(selection.query).toBe("cloudflare workers");
  });

  test("search ignores the handle parameter entirely", () => {
    const result = succeed({
      handle: "!!!",
      q: "x",
      resource: "search",
    });
    expect(result.selection._tag).toBe("search");
  });

  test.each(["top", "media", "latest"] as const)(
    "accepts feed=%s and reports it",
    (feed) => {
      const selection = searchSelection(
        succeed({ feed, q: "x", resource: "search" })
      );
      expect(selection.feed).toBe(feed);
    }
  );

  test("falls back to latest for unsupported feeds", () => {
    const selection = searchSelection(
      succeed({ feed: "hot", q: "x", resource: "search" })
    );
    expect(selection.feed).toBe("latest");
  });
});

describe("browse page/limit parsing", () => {
  test.each([
    [{ page: "3" }, 3],
    [{ page: 2 }, 2],
    [{}, 1],
    [{ page: "junk" }, 1],
    [{ page: "0" }, 1],
    [{ page: "-4" }, 1],
    [{ page: "99" }, 10],
  ])("page=%s parses to %i", (extra, expected) => {
    const result = succeed({ q: "x", resource: "search", ...extra });
    expect(result.page).toBe(expected);
  });

  test.each([
    [{ limit: "7" }, 7],
    [{ limit: 5 }, 5],
    [{}, 20],
    [{ limit: "junk" }, 20],
    [{ limit: "0" }, 20],
    [{ limit: "999" }, 50],
  ])("limit=%s parses to %i", (extra, expected) => {
    const result = succeed({ q: "x", resource: "search", ...extra });
    expect(result.limit).toBe(expected);
  });
});

describe("browse format and flag parsing", () => {
  test("refuses obsidian on browse resources", () => {
    const failure = failureOf({
      format: "obsidian",
      q: "x",
      resource: "search",
    });
    expect(failure).toMatchObject({
      _tag: "InvalidBrowseFormat",
      code: "invalid_format",
      message: "Browse `format` must be `markdown` or `json`.",
      status: 400,
    });
  });

  test.each([undefined, "", "markdown", "json"] as const)(
    "accepts format=%s",
    (format) => {
      const result = succeed({ format, q: "x", resource: "search" });
      expect(result.format).toBe(format === "json" ? "json" : "markdown");
    }
  );

  test('browse flags ignore "yes" (historical difference from convert)', () => {
    const result = succeed({
      full: "yes",
      nocache: "yes",
      q: "x",
      resource: "search",
    });
    expect({ full: result.full, nocache: result.nocache }).toStrictEqual({
      full: false,
      nocache: false,
    });
  });

  test("browse flags honor 1 and true", () => {
    const result = succeed({
      full: "true",
      nocache: "1",
      q: "x",
      resource: "search",
    });
    expect({ full: result.full, nocache: result.nocache }).toStrictEqual({
      full: true,
      nocache: true,
    });
  });
});

describe("browse handle parsing", () => {
  test("strips a leading @ from profile handles", () => {
    const result = succeed({ handle: "@ada", resource: "profile" });
    if (result.selection._tag === "search") {
      throw new Error("expected profile selection");
    }
    expect(result.selection.handle).toBe("ada");
  });

  test("refuses handles outside the X shape", () => {
    const failure = failureOf({
      handle: "not a handle!",
      resource: "profile",
    });
    expect(failure).toMatchObject({
      _tag: "InvalidXHandle",
      code: "invalid_handle",
      message: "A valid X handle is required.",
      status: 400,
    });
  });

  test("profile listings ignore the q parameter", () => {
    const result = succeed({
      handle: "ada",
      q: "ignored",
      resource: "profile",
    });
    expect(result.selection._tag).toBe("profile");
  });
});
