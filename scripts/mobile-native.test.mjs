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
import { inflateSync } from "node:zlib";
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

/** An 8-bit RGBA PNG's pixels, unfiltered: enough for the icons `tauri icon` writes. */
function readRgbaPng(path) {
  const bytes = readFileSync(resolve(repo, path));
  let width = 0;
  let height = 0;
  const data = [];
  for (let at = 8; at < bytes.length; ) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString("latin1", at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      expect([body[8], body[9], body[12]]).toEqual([8, 6, 0]);
    } else if (type === "IDAT") data.push(body);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x += 1) {
      const byte = raw[y * (stride + 1) + 1 + x];
      const left = x >= 4 ? pixels[y * stride + x - 4] : 0;
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const upLeft = x >= 4 && y > 0 ? pixels[(y - 1) * stride + x - 4] : 0;
      const guess = left + up - upLeft;
      const [a, b, c] = [Math.abs(guess - left), Math.abs(guess - up), Math.abs(guess - upLeft)];
      const paeth = a <= b && a <= c ? left : b <= c ? up : upLeft;
      const predictor = [0, left, up, (left + up) >> 1, paeth][filter];
      pixels[y * stride + x] = (byte + predictor) & 0xff;
    }
  }
  return { width, height, pixels };
}

/** How far the crest's gold reaches from the icon's centre, as a share of half its width. */
function goldReach({ width, height, pixels }) {
  let reach = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, alpha] = pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4);
      if (alpha > 128 && r > 180 && g > 140 && b < 90) {
        reach = Math.max(reach, Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2));
      }
    }
  }
  return reach / (width / 2);
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

  it("keeps the crest inside the splash circle and the launcher's safe zone", () => {
    // Android 12+ masks the splash icon to a circle of 2/3 of its size, and launchers keep only
    // the middle 66 of the adaptive icon's 108 dp safe for any mask shape (0.61 of half its
    // width). The foreground PNG draws the crest's corners at 0.65, so they touched the splash
    // circle on the API 35 AVD. Both use one inset copy of the foreground instead.
    const safe = "@drawable/ic_launcher_foreground_safe";
    const splashTheme = read("src-tauri/gen/android/app/src/main/res/values-v31/themes.xml");
    expect(splashTheme).toContain(
      `<item name="android:windowSplashScreenAnimatedIcon">${safe}</item>`,
    );
    const adaptive = read(
      "src-tauri/gen/android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml",
    );
    expect(adaptive).toContain(`<foreground android:drawable="${safe}"/>`);

    const inset = read(
      "src-tauri/gen/android/app/src/main/res/drawable/ic_launcher_foreground_safe.xml",
    );
    expect(inset).toContain('android:drawable="@mipmap/ic_launcher_foreground"');
    const percent = Number(/android:inset="([\d.]+)%"/.exec(inset)?.[1]);
    const scale = 1 - (2 * percent) / 100;
    const reach = goldReach(
      readRgbaPng(
        "src-tauri/gen/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png",
      ),
    );
    expect(reach).toBeGreaterThan(0.5);
    expect(reach * scale).toBeLessThanOrEqual(0.58);
  });

  it("draws light status-bar icons, over the navy the app paints under them", () => {
    // The page runs under a transparent status bar (edge to edge, enforced from API 35); the app
    // paints navy-900 there (PhoneBehaviors), so the clock and battery must be light in both
    // the phone's light and dark mode.
    const activity = read(
      "src-tauri/gen/android/app/src/main/java/com/sturdyrobot/openfootmanager/MainActivity.kt",
    );
    expect(activity).toMatch(
      /enableEdgeToEdge\(\s*statusBarStyle = SystemBarStyle\.dark\(Color\.TRANSPARENT\)/,
    );
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
  it("paints the web view navy until the page draws, so no white frame follows the splash", () => {
    // An Android WebView is white until the page paints, over the navy window and splash (seen on
    // the API 35 AVD between the splash and the login page). wry calls setBackgroundColor with the
    // window's backgroundColor. The windows list replaces the desktop one, so it keeps the rest.
    const desktopWindow = json("src-tauri/tauri.conf.json").app.windows[0];
    expect(androidConf.app?.windows).toEqual([{ ...desktopWindow, backgroundColor: "#0a1128" }]);
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

  it("draws light status-bar icons, over the navy the app paints under them", () => {
    expect(infoPlist).toMatch(
      /<key>UIStatusBarStyle<\/key>\s*<string>UIStatusBarStyleLightContent<\/string>/,
    );
    expect(infoPlist).toMatch(/<key>UIViewControllerBasedStatusBarAppearance<\/key>\s*<false\/>/);
    expect(projectYml).toMatch(/UIStatusBarStyle: UIStatusBarStyleLightContent/);
    expect(projectYml).toMatch(/UIViewControllerBasedStatusBarAppearance: false/);
  });

  it("carries the app's one version, the one in tauri.conf.json", () => {
    expect(projectYml).toContain(`CFBundleShortVersionString: ${appVersion}`);
    expect(infoPlist).toMatch(
      new RegExp(`<key>CFBundleShortVersionString</key>\\s*<string>${appVersion}</string>`),
    );
  });
});
