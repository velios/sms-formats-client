import { expect, it } from "bun:test";
import { restoreTestGlobals, setTestGlobal } from "./test-globals";

it("restores the original descriptor after repeated global replacements", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  setTestGlobal("localStorage", { getItem: () => "first" });
  setTestGlobal("localStorage", { getItem: () => "second" });
  expect(localStorage.getItem("key")).toBe("second");
  restoreTestGlobals();
  expect(Object.getOwnPropertyDescriptor(globalThis, "localStorage")).toEqual(
    original
  );
});

it("removes an introduced global and allows repeated restoration", () => {
  const name = "__smsFormatsTestGlobal__";
  expect(Reflect.has(globalThis, name)).toBe(false);
  setTestGlobal(name, "value");
  expect(Reflect.get(globalThis, name)).toBe("value");
  restoreTestGlobals();
  restoreTestGlobals();
  expect(Reflect.has(globalThis, name)).toBe(false);
});
