import { buildActivationScript } from "../src/actions.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("activation script serializes labels as data", () => {
  const script = buildActivationScript({
    id: "plugin",
    label: "Plugin",
    group: "Plugins",
    kind: "text",
    target: "@ebony-vinyl/dsh-our-free-model",
    matchText: ["Our Free Model", '";alert(1)//'],
    url: "",
  });
  assert(
    script.includes('["Our Free Model","\\";alert(1)//"]'),
    "labels were not safely serialized",
  );
  assert(!script.includes("alert(1)//'];"), "raw label escaped the script literal");
  assert(script.includes("async () =>"), "activation script should be asynchronous");
});
