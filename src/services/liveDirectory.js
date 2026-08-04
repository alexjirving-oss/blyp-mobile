/**
 * Live directory helpers — streams with directoryReady=false are hidden from discovery.
 */

export function isDirectoryVisible(data) {
  if (!data || typeof data !== 'object') return false;
  return data.directoryReady !== false;
}
