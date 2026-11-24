import { isLocalServiceEndpoint, shouldSyncLocalServiceUrl } from "../src/local-service-profile.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function assertFalse(condition: boolean, message: string): void {
  if (condition) throw new Error(message);
}

function assertEquals<T>(actual: T, expected: T): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("local service endpoint recognizes the slash before the authentication query", () => {
  assert(isLocalServiceEndpoint("http://127.0.0.1:3080/"), "the root URL should match");
  assert(
    isLocalServiceEndpoint("http://127.0.0.1:3080/?token=current"),
    "the slash-prefixed token URL should match",
  );
  assert(
    isLocalServiceEndpoint("http://127.0.0.1:3080?token=current"),
    "the token URL without a slash should match",
  );
});

Deno.test("local service endpoint rejects other hosts, ports, protocols, and paths", () => {
  assertFalse(isLocalServiceEndpoint("http://localhost:3080/"), "localhost should not match");
  assertFalse(isLocalServiceEndpoint("http://127.0.0.1:3081/"), "another port should not match");
  assertFalse(isLocalServiceEndpoint("https://127.0.0.1:3080/"), "HTTPS should not match");
  assertFalse(
    isLocalServiceEndpoint("http://127.0.0.1:3080/admin"),
    "another path should not match",
  );
  assertFalse(isLocalServiceEndpoint("not a URL"), "an invalid URL should not match");
});

Deno.test("local service profile follows a rotated authentication URL", () => {
  assert(
    shouldSyncLocalServiceUrl(
      "http://127.0.0.1:3080/?token=old",
      "http://127.0.0.1:3080/?token=new",
    ),
    "a rotated token URL should be synchronized",
  );
  assertFalse(
    shouldSyncLocalServiceUrl(
      "http://127.0.0.1:3080/?token=current",
      "http://127.0.0.1:3080/?token=current",
    ),
    "an unchanged URL should not be synchronized",
  );
  assertFalse(
    shouldSyncLocalServiceUrl(
      "https://example.com/?token=old",
      "http://127.0.0.1:3080/?token=new",
    ),
    "a remote profile should not be overwritten",
  );
  assertEquals(
    shouldSyncLocalServiceUrl(
      "http://127.0.0.1:3080/?token=old",
      "http://example.com/",
    ),
    false,
  );
});
