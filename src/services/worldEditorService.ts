import { invoke } from "./transport";

import type {
  CompetitionDef,
  ConfederationDef,
  CountryDef,
  NamesDefinition,
  PackageProjectData,
  PlayerDef,
  StaffDef,
  TeamDef,
  WorldMetaDef,
} from "../components/menu/PackageEditor/types";

/** Everything the editor writes back to a package project folder. */
export interface PackageProjectContents {
  dir: string;
  meta: WorldMetaDef;
  confederations: ConfederationDef[];
  countries: CountryDef[];
  teams: TeamDef[];
  players: PlayerDef[];
  staff: StaffDef[];
  names: NamesDefinition | null;
  competitions: CompetitionDef[];
}

/** Create an empty project folder for a new package. Resolves to its path. */
export async function createWorldProject(slug: string, meta: WorldMetaDef): Promise<string> {
  return invoke<string>("create_world_project", { slug, meta });
}

/** Write the whole project back to its folder, each entity to the file it came from. */
export async function savePackageProject(project: PackageProjectContents): Promise<void> {
  return invoke<void>("save_package_project", {
    dir: project.dir,
    meta: project.meta,
    confederations: project.confederations,
    countries: project.countries,
    teams: project.teams,
    players: project.players,
    staff: project.staff,
    names: project.names,
    competitions: project.competitions,
  });
}

/** Read a project folder, with the validation issues found in it. */
export async function readPackageProject(dir: string): Promise<PackageProjectData> {
  return invoke<PackageProjectData>("read_package_project", { dir });
}

/**
 * Get a project folder for the `.ofm` at `ofmPath`: the author's ongoing
 * project for an installed package, or the file's own contents when it was
 * `picked` on disk. Resolves to the folder's path.
 */
export async function extractOfmForEditing(ofmPath: string, picked: boolean): Promise<string> {
  return invoke<string>("extract_ofm_for_editing", { ofmPath, picked });
}

/** Pack the project folder `dir` into an `.ofm` file at `output`. */
export async function buildOfm(dir: string, output: string): Promise<void> {
  return invoke<void>("build_ofm", { dir, output });
}

/** Write the editor's teams to a CSV file at `output`. */
export async function exportTeamsCsv(teams: TeamDef[], output: string): Promise<void> {
  return invoke<void>("export_teams_csv", { teams, output });
}

/** Write the editor's players to a CSV file at `output`. */
export async function exportPlayersCsv(players: PlayerDef[], output: string): Promise<void> {
  return invoke<void>("export_players_csv", { players, output });
}

/**
 * Copy the image at `srcPath` into the project's assets, named for
 * `entityId`. Resolves to the copied file's path relative to the project.
 */
export async function copyPackageAsset(
  dir: string,
  entityId: string,
  srcPath: string,
): Promise<string> {
  return invoke<string>("copy_package_asset", { dir, entityId, srcPath });
}

/**
 * Read a package asset as a `data:` URL, so the editor can preview an image
 * that lives outside the app's served folders. `baseDir` bounds which files
 * the backend agrees to read.
 */
export async function readFileAsDataUrl(path: string, baseDir: string): Promise<string> {
  return invoke<string>("read_file_as_data_url", { path, baseDir });
}
