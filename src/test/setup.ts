import "@testing-library/jest-dom/vitest";
import { vi, afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  // jsdom keeps Web Storage for the whole file, so a test that stores a
  // ballot or wishlist leaks it into every later test in the file —
  // and into an unrelated describe that never set it. Reset it here so
  // each test starts from empty storage. The `window` guard covers
  // files that run in the node environment.
  if (typeof window !== "undefined") {
    window.localStorage?.clear();
    window.sessionStorage?.clear();
  }
});
