// ManifestService: placeholder for generating lightweight local HLS-style manifest
// Non-breaking transitional utility. Will be replaced by server-side generation later.
// Produces a pseudo-m3u8 string referencing segment subcollection URLs.

import StreamSegmentsAdapter from './StreamSegmentsAdapter';

class ManifestService {
  async generateLocalManifest(streamId, variant = 'source') {
    const segments = await StreamSegmentsAdapter.getWindow(streamId, 50); // up to 50 recent segments
    if (!segments.length) return '';
    const lines = [
      '#EXTM3U',
      '#EXT-X-VERSION:3',
      '#EXT-X-TARGETDURATION:3',
      `#EXT-X-MEDIA-SEQUENCE:${segments[0].number}`
    ];
    segments.forEach(seg => {
      lines.push('#EXTINF:3.0,'); // placeholder duration
      lines.push(seg.url);
    });
    return lines.join('\n');
  }
}

export default new ManifestService();
