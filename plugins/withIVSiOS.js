/**
 * Expo config plugin: integrate the Amazon IVS iOS SDKs + Blyp's native bridge.
 *
 * What it does during `expo prebuild` (iOS):
 *   1. Info.plist: camera/mic usage strings + background `audio` mode (lets a stage
 *      keep playing remote audio when backgrounded, per AWS guidance).
 *   2. Podfile: adds `AmazonIVSBroadcast` (Stages) and `AmazonIVSPlayer` pods,
 *      matching the Android SDK families (broadcast 1.37.x / player 1.47.x).
 *   3. Copies the Swift/ObjC bridge sources from `plugins/ivs-ios/` into the iOS
 *      target and registers them in the Xcode project.
 *   4. Ensures a Swift bridging header imports the React headers the modules need
 *      and points `SWIFT_OBJC_BRIDGING_HEADER` at it.
 *
 * The Swift sources mirror the Android Kotlin contract (`IVSBroadcastModule`,
 * `IVSPlayerModule`, and the three native views) so the shared JS layer is identical.
 */
const {
  withInfoPlist,
  withDangerousMod,
  withXcodeProject,
  IOSConfig,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.join(__dirname, 'ivs-ios');
const SOURCE_FILES = [
  'BlypIVSRenderRegistry.swift',
  'IVSBroadcastModule.swift',
  'IVSPlayerModule.swift',
  'IVSViews.swift',
  'IVSBridges.m',
];

const REACT_BRIDGING_IMPORTS = [
  '#import <React/RCTBridgeModule.h>',
  '#import <React/RCTEventEmitter.h>',
  '#import <React/RCTViewManager.h>',
];

const IVS_BROADCAST_POD = 'AmazonIVSBroadcast';
const IVS_BROADCAST_VERSION = '~> 1.37.0';
const IVS_PLAYER_POD = 'AmazonIVSPlayer';
const IVS_PLAYER_VERSION = '~> 1.47.0';

function withIVSInfoPlist(config) {
  return withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;
    plist.NSCameraUsageDescription =
      plist.NSCameraUsageDescription || 'This app needs access to camera to go live and join live streams.';
    plist.NSMicrophoneUsageDescription =
      plist.NSMicrophoneUsageDescription || 'This app needs access to microphone to broadcast audio on live streams.';

    const modes = new Set(Array.isArray(plist.UIBackgroundModes) ? plist.UIBackgroundModes : []);
    modes.add('audio');
    plist.UIBackgroundModes = Array.from(modes);
    return cfg;
  });
}

function withIVSPods(config) {
  return withDangerousMod(config, [
    'ios',
    (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      if (!fs.existsSync(podfilePath)) {
        return cfg;
      }
      let contents = fs.readFileSync(podfilePath, 'utf8');
      if (contents.includes(IVS_BROADCAST_POD)) {
        return cfg;
      }

      const podLines = [
        `  pod '${IVS_BROADCAST_POD}', '${IVS_BROADCAST_VERSION}'`,
        `  pod '${IVS_PLAYER_POD}', '${IVS_PLAYER_VERSION}'`,
      ].join('\n');

      // Insert right after the first `target '...' do` so the pods land inside the app target.
      const targetRegex = /(target\s+['"][^'"]+['"]\s+do\b.*\n)/;
      if (targetRegex.test(contents)) {
        contents = contents.replace(targetRegex, `$1${podLines}\n`);
      } else {
        contents += `\n${podLines}\n`;
      }
      fs.writeFileSync(podfilePath, contents, 'utf8');
      return cfg;
    },
  ]);
}

function ensureBridgingHeader(projectRoot, projectName) {
  const iosSourceDir = path.join(projectRoot, 'ios', projectName);
  if (!fs.existsSync(iosSourceDir)) {
    fs.mkdirSync(iosSourceDir, { recursive: true });
  }
  const headerName = `${projectName}-Bridging-Header.h`;
  const headerPath = path.join(iosSourceDir, headerName);

  let header = fs.existsSync(headerPath) ? fs.readFileSync(headerPath, 'utf8') : '';
  let changed = false;
  for (const imp of REACT_BRIDGING_IMPORTS) {
    if (!header.includes(imp)) {
      header += `${header.endsWith('\n') || header.length === 0 ? '' : '\n'}${imp}\n`;
      changed = true;
    }
  }
  if (changed || !fs.existsSync(headerPath)) {
    fs.writeFileSync(headerPath, header, 'utf8');
  }
  return `${projectName}/${headerName}`;
}

function withIVSSources(config) {
  return withXcodeProject(config, (cfg) => {
    const project = cfg.modResults;
    const projectRoot = cfg.modRequest.projectRoot;
    const projectName = cfg.modRequest.projectName;

    // 1. Copy bridge sources into ios/<projectName>/IVS/.
    const destDir = path.join(projectRoot, 'ios', projectName, 'IVS');
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    for (const file of SOURCE_FILES) {
      const src = path.join(SOURCE_DIR, file);
      const dest = path.join(destDir, file);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
      }
    }

    // 2. Register the sources in the Xcode project (compiled into the app target).
    const groupName = `${projectName}/IVS`;
    for (const file of SOURCE_FILES) {
      const filepath = `${projectName}/IVS/${file}`;
      try {
        if (!project.hasFile(filepath)) {
          IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
            filepath,
            groupName,
            project,
          });
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[withIVSiOS] could not add ${filepath}:`, e.message);
      }
    }

    // 3. Bridging header + Swift version across all build configurations.
    const bridgingHeaderRef = ensureBridgingHeader(projectRoot, projectName);
    const configurations = project.pbxXCBuildConfigurationSection();
    for (const key of Object.keys(configurations)) {
      const buildSettings = configurations[key].buildSettings;
      if (!buildSettings) continue;
      if (!buildSettings.SWIFT_OBJC_BRIDGING_HEADER) {
        buildSettings.SWIFT_OBJC_BRIDGING_HEADER = `"${bridgingHeaderRef}"`;
      }
      if (!buildSettings.SWIFT_VERSION) {
        buildSettings.SWIFT_VERSION = '5.0';
      }
    }

    return cfg;
  });
}

module.exports = function withIVSiOS(config) {
  config = withIVSInfoPlist(config);
  config = withIVSPods(config);
  config = withIVSSources(config);
  return config;
};
