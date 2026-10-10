import { describe, expect, it } from "vitest";

import { rememberRecentProject } from "./recentProjects";

const at = "2026-10-10T00:00:00.000Z";

describe("rememberRecentProject", () => {
  // Given projects already listed, when one is opened, then it goes to the top
  // with the file it came from, and earlier entries follow.
  it("puts the project just opened first, with its source file", () => {
    const list = rememberRecentProject(
      [{ path: "/p/old", name: "Old", openedAt: at }],
      { path: "/p/new", name: "New", source: "/downloads/world.ofm" },
      at,
    );

    expect(list.map((project) => [project.path, project.source])).toEqual([
      ["/p/new", "/downloads/world.ofm"],
      ["/p/old", undefined],
    ]);
  });

  // Given a project listed already, when it is opened again, then it moves to
  // the top rather than appearing twice.
  it("lists a project once however often it is opened", () => {
    const list = rememberRecentProject(
      [
        { path: "/p/a", name: "A", openedAt: at },
        { path: "/p/b", name: "B", openedAt: at },
      ],
      { path: "/p/b", name: "B" },
      at,
    );

    expect(list.map((project) => project.path)).toEqual(["/p/b", "/p/a"]);
  });

  // Given a full list, when another project is opened, then the oldest drops off.
  it("keeps the list to its limit", () => {
    const full = Array.from({ length: 8 }, (_, index) => ({
      path: `/p/${index}`,
      name: `${index}`,
      openedAt: at,
    }));

    const list = rememberRecentProject(full, { path: "/p/new", name: "New" }, at);

    expect(list).toHaveLength(8);
    expect(list[list.length - 1].path).toBe("/p/6");
  });
});
