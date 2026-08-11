/**
 * Expo config plugin: BlypShorts AVPlayer pool (iOS) — ground-up For You path.
 */
const {
  withDangerousMod,
  withXcodeProject,
  IOSConfig,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.join(__dirname, 'blyp-shorts-ios');
const SOURCE_FILES = [
  'ShortsPool.swift',
  'ShortsSurfaceView.swift',
  'ShortsViewManager.swift',
  'ShortsModule.swift',
  'ShortsBridges.m',
];

const REACT_BRIDGING_IMPORTS = [
  '#import <React/RCTBridgeModule.h>',
  '#import <React/RCTEventEmitter.h>',
  '#import <React/RCTViewManager.h>',
];

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

function withShortsSources(config) {
  return withXcodeProject(config, (cfg) => {
    const projectRoot = cfg.modRequest.projectRoot;
    const projectName = IOSConfig.XcodeUtils.getProjectName(projectRoot);
    const project = cfg.modResults;
    const destDir = path.join(projectRoot, 'ios', projectName, 'BlypShorts');
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    ensureBridgingHeader(projectRoot, projectName);

    for (const file of SOURCE_FILES) {
      const src = path.join(SOURCE_DIR, file);
      const dest = path.join(destDir, file);
      if (!fs.existsSync(src)) continue;
      fs.copyFileSync(src, dest);
      const filepath = `${projectName}/BlypShorts/${file}`;
      try {
        if (!project.hasFile(filepath)) {
          project.addSourceFile(filepath, null, project.findPBXGroupKey({ name: projectName }));
        }
      } catch (e) {
        console.warn(`[withBlypShortsIOS] could not add ${filepath}:`, e.message);
      }
    }
    return cfg;
  });
}

module.exports = function withBlypShortsIOS(config) {
  return withShortsSources(config);
};
