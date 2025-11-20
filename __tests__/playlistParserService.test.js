import PlaylistParserService from '../src/services/PlaylistParserService';

const sampleQuality = `#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:10\n\n#EXTINF:2.0,\nsegment_10.mp4\n#EXTINF:2.0,\nsegment_11.mp4\n#EXTINF:2.0,\nsegment_12.mp4\n`;

describe('PlaylistParserService', () => {
  test('parseQuality extracts segments with numbers', () => {
    const segs = PlaylistParserService.parseQuality(sampleQuality);
    expect(segs.length).toBe(3);
    expect(segs[0].number).toBe(10);
    expect(segs[2].url).toBe('segment_12.mp4');
  });

  test('parseMaster returns variants list', () => {
    const master = `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=400000,RESOLUTION=426x240\n240p.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=854x480\n480p.m3u8\n`;
    const parsed = PlaylistParserService.parseMaster(master);
    expect(parsed.variants.length).toBe(2);
    expect(parsed.variants[1].playlist).toBe('480p.m3u8');
  });
});
