import QualitySelectionService from '../src/services/QualitySelectionService';

describe('QualitySelectionService.chooseQuality', () => {
  const variants = [
    { playlist: '240p.m3u8' },
    { playlist: '480p.m3u8' },
    { playlist: '720p.m3u8' }
  ];

  test('wifi chooses 720p', () => {
    expect(QualitySelectionService.chooseQuality(variants, 'wifi')).toBe('720p');
  });

  test('cellular chooses mid quality 480p', () => {
    expect(QualitySelectionService.chooseQuality(variants, 'cellular')).toBe('480p');
  });

  test('offline chooses lowest 240p', () => {
    expect(QualitySelectionService.chooseQuality(variants, 'offline')).toBe('240p');
  });

  test('unknown chooses lowest', () => {
    expect(QualitySelectionService.chooseQuality(variants, 'unknown')).toBe('240p');
  });
});
