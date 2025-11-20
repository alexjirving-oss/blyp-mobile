// QualitySelectionService: chooses appropriate quality variant given network conditions.
// Heuristic prioritizes stability and startup speed.

class QualitySelectionService {
  chooseQuality(variants, networkType) {
    if (!Array.isArray(variants) || variants.length === 0) return null;
    // Normalize network type
    const type = (networkType || '').toLowerCase();
    // Map variant playlist filenames to quality name (strip .m3u8)
    const qualities = variants.map(v => v.playlist.replace('.m3u8',''));
    // Sort qualities by presumed resolution ascending (240p,480p,720p,1080p)
    const order = ['240p','360p','480p','540p','720p','1080p','1440p','2160p'];
    const sorted = qualities.sort((a,b) => order.indexOf(a) - order.indexOf(b));

    // Offline fallback: lowest
    if (type === 'offline') return sorted[0];
    // Cellular heuristics
    if (type === 'cellular') {
      // For early adoption pick mid-quality if available (480p or 540p), else next best
      const mid = sorted.find(q => ['480p','540p'].includes(q));
      return mid || sorted[Math.min(1, sorted.length - 1)];
    }
    // Wifi: choose high but not extreme (prefer 720p if available)
    if (type === 'wifi') {
      const preferred = sorted.find(q => q === '720p') || sorted[sorted.length - 1];
      return preferred;
    }
    // Unknown: conservative
    return sorted[0];
  }
}

export default new QualitySelectionService();
