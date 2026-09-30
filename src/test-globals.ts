const descriptors = new Map<string, PropertyDescriptor | undefined>();

export function setTestGlobal(name: string, value: unknown): void {
  if (!descriptors.has(name)) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  }
  Object.defineProperty(globalThis, name, {
    value,
    configurable: true,
    writable: true,
  });
}

export function restoreTestGlobals(): void {
  for (const [name, descriptor] of descriptors) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor);
    } else {
      Reflect.deleteProperty(globalThis, name);
    }
  }
  descriptors.clear();
}
