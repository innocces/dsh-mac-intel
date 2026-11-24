import { redactAuthenticationToken } from "../src/connection.ts";

function assertEquals(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

Deno.test("connection diagnostics redact one-time DSH authentication tokens", () => {
  assertEquals(
    redactAuthenticationToken("http://127.0.0.1:3080/?token=secret-token"),
    "http://127.0.0.1:3080",
  );
  assertEquals(
    redactAuthenticationToken("https://dsh.example.com/path"),
    "https://dsh.example.com/path",
  );
});
