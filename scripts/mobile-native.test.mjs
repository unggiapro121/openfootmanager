// @vitest-environment node
//
// The phone app's native project files, read as text (phase 5 M2b of m2-tech-spec).
//
// `src-tauri/gen/` is generated once by `tauri android|ios init` and then edited by hand: a later
// `init`, or a careless edit, can put back what the store releases must not have (a TV launcher,
// cloud backup of the refresh token, a lower platform floor) without any build failing. Each case
// below names one such promise and reads the file that keeps it.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(repo, path), "utf8");
const json = (path) => JSON.parse(read(path));

const manifest = read("src-tauri/gen/android/app/src/main/AndroidManifest.xml");
const gradle = read("src-tauri/gen/android/app/build.gradle.kts");
const projectYml = read("src-tauri/gen/apple/project.yml");
const pbxproj = read("src-tauri/gen/apple/openfootmanager.xcodeproj/project.pbxproj");
const infoPlist = read("src-tauri/gen/apple/openfootmanager_iOS/Info.plist");
const androidConf = json("src-tauri/tauri.android.conf.json");
const iosConf = json("src-tauri/tauri.ios.conf.json");
const appVersion = json("src-tauri/tauri.conf.json").version;

const BACKUP_DOMAINS = ["root", "file", "database", "sharedpref", "external"];

/** The domains a `<parent>…</parent>` block of a backup rules file excludes. */
function excludedDomains(xml, parent) {
  const block = new RegExp(`<${parent}[^>]*>([\\s\\S]*?)</${parent}>`).exec(xml);
  if (!block) return [];
  return [...block[1].matchAll(/<exclude\s+domain="([^"]+)"/g)].map((m) => m[1]).sort();
}

describe("Android", () => {
  it("is not offered to TVs", () => {
    expect(manifest).not.toContain("leanback");
    expect(manifest).not.toContain("LEANBACK_LAUNCHER");
  });

  it("keeps the main activity upright", () => {
    expect(manifest).toMatch(/<activity[^>]*android:screenOrientation="portrait"/);
  });

  it("turns off backup and device transfer on every Android version", () => {
    expect(manifest).toContain('android:allowBackup="false"');
    expect(manifest).toContain('android:fullBackupContent="@xml/backup_rules"');
    expect(manifest).toContain('android:dataExtractionRules="@xml/data_extraction_rules"');
  });

  it("excludes all five data domains from cloud backup and from device transfer", () => {
    const rules = read("src-tauri/gen/android/app/src/main/res/xml/data_extraction_rules.xml");
    expect(excludedDomains(rules, "cloud-backup")).toEqual([...BACKUP_DOMAINS].sort());
    expect(excludedDomains(rules, "device-transfer")).toEqual([...BACKUP_DOMAINS].sort());
  });

  it("excludes all five data domains from the backup of Android 11 and older", () => {
    const rules = read("src-tauri/gen/android/app/src/main/res/xml/backup_rules.xml");
    expect(excludedDomains(rules, "full-backup-content")).toEqual([...BACKUP_DOMAINS].sort());
  });

  it("fills the adaptive icon's background with the navy of the crest's tile, not white", () => {
    // The foreground draws a navy tile, darker toward the bottom, over a transparent margin. A
    // launcher's parallax or a themed icon can show the background around it, so the background
    // takes the tile's colour at the middle of its edge (#161F39), not white and not the darker
    // splash navy, either of which would show as a rim.
    const colors = read("src-tauri/gen/android/app/src/main/res/values/ic_launcher_background.xml");
    expect(colors).toMatch(/<color name="ic_launcher_background">#FF161F39<\/color>/);
  });

  it("needs Android 8.0 (API 26), in the Gradle file and in the Tauri config alike", () => {
    expect(gradle).toMatch(/\bminSdk = 26\b/);
    expect(androidConf.bundle?.android?.minSdkVersion).toBe(26);
  });

  it("allows plain HTTP only in debug builds", () => {
    expect(gradle).toMatch(/defaultConfig \{[\s\S]*?usesCleartextTraffic"\] = "false"/);
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a Gradle manifest placeholder, not JS
    expect(manifest).toContain('android:usesCleartextTraffic="${usesCleartextTraffic}"');
  });
});

describe("iOS", () => {
  it("needs iOS 16.4, in the project, the Xcode project and the Tauri config alike", () => {
    expect(projectYml).toMatch(/deploymentTarget:\s*\n\s*iOS: "?16\.4"?/);
    expect(iosConf.bundle?.iOS?.minimumSystemVersion).toBe("16.4");
    const targets = [...pbxproj.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/g)].map(
      (m) => m[1],
    );
    expect(targets.length).toBeGreaterThan(0);
    expect(new Set(targets)).toEqual(new Set(["16.4"]));
  });

  it("is an iPhone app only", () => {
    const families = [...pbxproj.matchAll(/TARGETED_DEVICE_FAMILY = "?([\d,]+)"?;/g)].map(
      (m) => m[1],
    );
    expect(families.length).toBeGreaterThan(0);
    expect(new Set(families)).toEqual(new Set(["1"]));
    expect(projectYml).toMatch(/TARGETED_DEVICE_FAMILY: "?1"?/);
    expect(projectYml).not.toContain("~ipad");
    expect(infoPlist).not.toContain("~ipad");
  });

  it("stays upright", () => {
    const orientations = (text) =>
      [...text.matchAll(/UIInterfaceOrientation[A-Za-z]+/g)].map((m) => m[0]);
    expect(new Set(orientations(infoPlist))).toEqual(new Set(["UIInterfaceOrientationPortrait"]));
    expect(new Set(orientations(projectYml))).toEqual(new Set(["UIInterfaceOrientationPortrait"]));
  });

  it("paints the web view navy until the page draws, so no white frame follows the launch screen", () => {
    // A WKWebView is white until the page paints. Tauri hands a window's backgroundColor to the web
    // view (non-opaque over a view of that color). The windows list replaces the desktop one on
    // iOS, so it also keeps the desktop window's other settings.
    const desktopWindow = json("src-tauri/tauri.conf.json").app.windows[0];
    expect(iosConf.app?.windows).toEqual([{ ...desktopWindow, backgroundColor: "#0a1128" }]);
  });

  it("carries the app's one version, the one in tauri.conf.json", () => {
    expect(projectYml).toContain(`CFBundleShortVersionString: ${appVersion}`);
    expect(infoPlist).toMatch(
      new RegExp(`<key>CFBundleShortVersionString</key>\\s*<string>${appVersion}</string>`),
    );
  });
});
