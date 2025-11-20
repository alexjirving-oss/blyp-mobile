// PlaylistParserService: parses a local manifest (pseudo or real) into segment objects.
// Transitional: currently uses local manifest generation; later will fetch master/quality playlists from storage/CDN.
// Safe: does not modify Firestore or storage.

class PlaylistParserService {
  parseMaster(masterContent) {
    if (!masterContent) return { variants: [] };
    const lines = masterContent.split(/\r?\n/);
    const variants = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#EXT-X-STREAM-INF')) {
        // Extract BANDWIDTH attribute if present (bits per second)
        let bandwidth;
        const bwMatch = line.match(/BANDWIDTH=(\d+)/);
        if (bwMatch) bandwidth = parseInt(bwMatch[1], 10);
        const next = lines[i + 1];
        if (next && !next.startsWith('#')) {
          variants.push({ playlist: next.trim(), bandwidth });
        }
      }
    }
    return { variants };
  }

  parseQuality(qualityContent) {
    if (!qualityContent) return [];
    const lines = qualityContent.split(/\r?\n/);
    const segments = [];
    let mediaSequence = 0;
    let targetDuration = 0;
    lines.forEach(line => {
      if (line.startsWith('#EXT-X-MEDIA-SEQUENCE')) {
        mediaSequence = parseInt(line.split(':')[1] || '0', 10);
      } else if (line.startsWith('#EXT-X-TARGETDURATION')) {
        targetDuration = parseFloat(line.split(':')[1] || '0');
      }
    });
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('#EXTINF')) {
        const durationMatch = line.match(/#EXTINF:([0-9.]+),/);
        const duration = durationMatch ? parseFloat(durationMatch[1]) : targetDuration || 0;
        const uri = lines[i + 1];
        if (uri && !uri.startsWith('#')) {
          segments.push({
            number: mediaSequence + segments.length,
            url: uri.trim(),
            duration
          });
        }
      }
    }
    return segments;
  }
}

export default new PlaylistParserService();
