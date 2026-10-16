import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import {
  buildOfm,
  copyPackageAsset,
  createWorldProject,
  exportPlayersCsv,
  exportTeamsCsv,
  extractOfmForEditing,
  readFileAsDataUrl,
  readPackageProject,
  savePackageProject,
} from "./worldEditorService";
import { emptyMeta, emptyPlayer, emptyTeam } from "../components/menu/PackageEditor/helpers";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

const meta = { ...emptyMeta(), id: "my-world", name: "My World" };
const teams = [{ ...emptyTeam(), id: "team-1", name: "Alpha FC" }];
const players = [{ ...emptyPlayer(), id: "player-1", name: "Ana Silva" }];

describe("worldEditorService", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  // Given new metadata, when a project is created, then the backend gets its
  // slug and metadata and the new folder's path comes back.
  it("creates a world project from its slug and metadata", async () => {
    mockedInvoke.mockResolvedValueOnce("/projects/my-world");

    await expect(createWorldProject("my-world", meta)).resolves.toBe("/projects/my-world");
    expect(mockedInvoke).toHaveBeenCalledWith("create_world_project", { slug: "my-world", meta });
  });

  // Given the editor's state, when the project is saved, then the backend gets
  // the folder and every entity list.
  it("saves the whole package project", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    const project = {
      dir: "/projects/my-world",
      meta,
      confederations: [],
      countries: [],
      teams,
      players,
      staff: [],
      names: null,
      competitions: [],
    };

    await savePackageProject(project);
    expect(mockedInvoke).toHaveBeenCalledWith("save_package_project", project);
  });

  // Given a write that fails, when the project is saved, then the error key
  // reaches the caller, which shows it and marks the save as failed.
  it("passes a failed save's error key through", async () => {
    mockedInvoke.mockRejectedValueOnce("be.error.package.writeFailed");

    await expect(
      savePackageProject({
        dir: "/projects/my-world",
        meta,
        confederations: [],
        countries: [],
        teams: [],
        players: [],
        staff: [],
        names: null,
        competitions: [],
      }),
    ).rejects.toBe("be.error.package.writeFailed");
  });

  // Given a project folder, when it is read, then the backend gets the folder.
  it("reads a package project by folder", async () => {
    const data = { meta, issues: [] };
    mockedInvoke.mockResolvedValueOnce(data);

    await expect(readPackageProject("/projects/my-world")).resolves.toBe(data);
    expect(mockedInvoke).toHaveBeenCalledWith("read_package_project", {
      dir: "/projects/my-world",
    });
  });

  // Given an .ofm picked on disk, when it is opened, then the backend gets the
  // file path with the picked flag and the project folder comes back.
  it("extracts an ofm for editing", async () => {
    mockedInvoke.mockResolvedValueOnce("/projects/extracted");

    await expect(extractOfmForEditing("/downloads/world.ofm", true)).resolves.toBe(
      "/projects/extracted",
    );
    expect(mockedInvoke).toHaveBeenCalledWith("extract_ofm_for_editing", {
      ofmPath: "/downloads/world.ofm",
      picked: true,
    });
  });

  // Given a project and an output path, when it is built, then the backend gets both.
  it("builds an ofm from a project folder", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);

    await buildOfm("/projects/my-world", "/out/my-world.ofm");
    expect(mockedInvoke).toHaveBeenCalledWith("build_ofm", {
      dir: "/projects/my-world",
      output: "/out/my-world.ofm",
    });
  });

  // Given the editor's teams, when they are exported, then the backend gets the
  // in-memory list and the CSV path.
  it("exports the teams as csv", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);

    await exportTeamsCsv(teams, "/out/teams.csv");
    expect(mockedInvoke).toHaveBeenCalledWith("export_teams_csv", {
      teams,
      output: "/out/teams.csv",
    });
  });

  // Given the editor's players, when they are exported, then the backend gets
  // the in-memory list and the CSV path.
  it("exports the players as csv", async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);

    await exportPlayersCsv(players, "/out/players.csv");
    expect(mockedInvoke).toHaveBeenCalledWith("export_players_csv", {
      players,
      output: "/out/players.csv",
    });
  });

  // Given a picked image, when it is copied into the package, then the backend
  // gets the folder, the entity id and the source, and the relative path comes back.
  it("copies a package asset for an entity", async () => {
    mockedInvoke.mockResolvedValueOnce("assets/images/team-1.png");

    await expect(
      copyPackageAsset("/projects/my-world", "team-1", "/pictures/crest.png"),
    ).resolves.toBe("assets/images/team-1.png");
    expect(mockedInvoke).toHaveBeenCalledWith("copy_package_asset", {
      dir: "/projects/my-world",
      entityId: "team-1",
      srcPath: "/pictures/crest.png",
    });
  });

  // Given an asset inside a project, when the editor previews it, then the
  // backend gets the full path and the project folder as the read boundary.
  it("reads a package asset as a data URL", async () => {
    mockedInvoke.mockResolvedValueOnce("data:image/png;base64,AAAA");

    await expect(
      readFileAsDataUrl("/projects/my-world/assets/crest.png", "/projects/my-world"),
    ).resolves.toBe("data:image/png;base64,AAAA");
    expect(mockedInvoke).toHaveBeenCalledWith("read_file_as_data_url", {
      path: "/projects/my-world/assets/crest.png",
      baseDir: "/projects/my-world",
    });
  });
});
