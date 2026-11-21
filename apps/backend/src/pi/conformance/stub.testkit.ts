/**
 * A stand-in for a dependency that a conformance group has not stubbed yet. Reading a property gives another stand-in, so a
 * module can be composed and its tool catalogue read; calling one throws, so a tool that really needs the dependency fails
 * the callable check loudly and names what is missing instead of returning invented data.
 */
export class UnstubbedDependencyError extends Error {
  constructor(path: string) {
    super(`The conformance stub for ${path} is not implemented.`);
    this.name = 'UnstubbedDependencyError';
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function unstubbed(path: string): any {
  return new Proxy(function () {}, {
    get: (_target, property) => {
      // `then` must stay undefined so an await on a stand-in does not try to adopt it as a promise.
      if (property === 'then' || typeof property === 'symbol') return undefined;
      return unstubbed(`${path}.${property}`);
    },
    apply: () => { throw new UnstubbedDependencyError(path); },
    construct: () => { throw new UnstubbedDependencyError(path); },
  });
}
