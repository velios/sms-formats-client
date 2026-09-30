import { afterAll, afterEach, expect } from "bun:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

for (const key of Object.getOwnPropertyNames(dom.window)) {
  if (!(key in globalThis)) {
    Object.defineProperty(globalThis, key, {
      ...Object.getOwnPropertyDescriptor(dom.window, key)!,
      configurable: true,
    });
  }
}

const storage = dom.window.localStorage;
Object.defineProperty(globalThis, "localStorage", {
  get: () => dom.window.localStorage,
  configurable: true,
});

for (const key of ["Event", "CustomEvent", "EventTarget"]) {
  Object.defineProperty(globalThis, key, {
    value: Reflect.get(dom.window, key),
    configurable: true,
    writable: true,
  });
}

// Matchers also import Testing Library; load them only after installing the DOM.
const { default: _default, ...matchers } = await import(
  "@testing-library/jest-dom/matchers"
);
expect.extend(matchers);
const { cleanup } = await import("@testing-library/react/pure");

afterEach(() => {
  cleanup();
  storage.clear();
});
afterAll(() => dom.window.close());
