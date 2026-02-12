import { describe, expect, it } from "vitest";
import { threeWayMerge } from "./merge";

describe("threeWayMerge", () => {
  it("uses remote when local unchanged", () => {
    const result = threeWayMerge("base", "base", "remote new", "file.txt");
    expect(result.status).toBe("unchanged");
    expect(result.content).toBe("remote new");
  });

  it("keeps local when remote unchanged", () => {
    const result = threeWayMerge("base", "local edit", "base", "file.txt");
    expect(result.status).toBe("clean");
    expect(result.content).toBe("local edit");
  });

  it("resolves identically changed content", () => {
    const result = threeWayMerge("base", "same", "same", "file.txt");
    expect(result.status).toBe("clean");
    expect(result.content).toBe("same");
  });

  it("detects true conflict", () => {
    const base = "line1\nline2\nline3";
    const local = "line1\nlocal change\nline3";
    const remote = "line1\nremote change\nline3";
    const result = threeWayMerge(base, local, remote, "file.txt");
    expect(result.status).toBe("conflict");
    expect(result.content).toContain("<<<<<<< LOCAL");
    expect(result.content).toContain(">>>>>>> REMOTE");
  });

  it("merges non-conflicting line changes", () => {
    const base = "line1\nline2\nline3";
    const local = "line1\nlocal\nline3";
    const remote = "line1\nline2\nremote";
    const result = threeWayMerge(base, local, remote, "file.txt");
    expect(result.status).toBe("clean");
    expect(result.content).toBe("line1\nlocal\nremote");
  });
});
