import { createContext, useContext, useEffect, useState } from "react";

import { resolveLocalMediaPath } from "../lib/mediaAssets";
import { useAssetDataUrl } from "./useAssetDataUrl";
import { isPackageQualifiedAsset, joinAssetRoot } from "../lib/packageAssets";
import { appDataDirectory, localFileUrl } from "../services/platformService";

/**
 * The app data directory, resolved once per session.
 *
 * Every club badge and player face on a screen asks for this, so the lookup is
 * shared rather than repeated per image.
 */
let appDataDirPromise: Promise<string> | null = null;

function resolveAppDataDir(): Promise<string> {
  // Only a resolved lookup is worth keeping. A rejected promise is still
  // truthy, so caching one would turn a single transient failure into "no
  // package artwork anywhere until the app restarts".
  appDataDirPromise ??= appDataDirectory().catch((err) => {
    appDataDirPromise = null;
    throw err;
  });
  return appDataDirPromise;
}

/** Test seam: drop the cached directory so each test starts clean. */
export function resetPackageAssetRoot(): void {
  appDataDirPromise = null;
}

/**
 * The package project folder whose assets the screens inside show, in the
 * world editor. A project's paths are package-relative (`assets/players/…`),
 * which reads as an asset bundled with the app, and the folder lies outside
 * what the asset protocol may serve, so inside this context every path is
 * read from the project instead. Null (the default) is the running game.
 */
export const ProjectAssetDirContext = createContext<string | null>(null);

/**
 * Turn a stored media path into something an `<img>` can load.
 *
 * Assets bundled with the app resolve synchronously against the frontend root.
 * Assets extracted from an installed package live outside the bundle and have
 * to go through Tauri's asset protocol, which needs the app data directory —
 * so those resolve on a later tick and the hook re-renders.
 */
export function usePackageAssetSrc(path: string | null | undefined): string | null {
  const projectDir = useContext(ProjectAssetDirContext);
  const projectSrc = useAssetDataUrl(projectDir ? path : null, projectDir ?? undefined);
  const bundled = isPackageQualifiedAsset(path) ? null : resolveLocalMediaPath(path);
  const [packageSrc, setPackageSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!isPackageQualifiedAsset(path)) {
      setPackageSrc(null);
      return;
    }

    let active = true;
    resolveAppDataDir()
      .then((dir) => {
        if (!active) return;
        setPackageSrc(localFileUrl(joinAssetRoot(dir, path!.trim())));
      })
      .catch(() => {
        // No app data dir means no package assets; the caller's fallback
        // (a generated crest or portrait) is the right outcome, not an error.
        if (active) setPackageSrc(null);
      });

    return () => {
      active = false;
    };
  }, [path]);

  if (projectDir) return projectSrc;
  return bundled ?? packageSrc;
}
