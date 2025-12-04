import {
  buildFinalCaption,
  type BuildFinalCaptionResult,
} from '../buildFinalCaption';

const photos = [{ id: 'p1' }, { id: 'p2' }];

const fullAiMap = {
  p1: 'First photo AI caption.',
  p2: 'Second photo AI caption.',
};

describe('buildFinalCaption - smart merge mode (Option B)', () => {
  it('uses manual caption when provided (highest priority)', () => {
    const result = buildFinalCaption({
      manualCaption: 'My custom caption',
      voiceCaption: 'Spoken description',
      aiCaptionsByPhotoId: fullAiMap,
      photos,
    });

    expect(result).toEqual<BuildFinalCaptionResult>({
      finalCaption: 'My custom caption',
      source: 'manual',
    });
  });

  it('treats whitespace-only manual caption as empty and falls back to smart merge', () => {
    const result = buildFinalCaption({
      manualCaption: '   ',
      voiceCaption: 'Spoken description',
      aiCaptionsByPhotoId: fullAiMap,
      photos,
    });

    expect(result.source).toBe('smart-merge');
    expect(result.finalCaption.startsWith('Spoken description')).toBe(true);
  });

  it('merges voice + AI when both are present', () => {
    const result = buildFinalCaption({
      manualCaption: '',
      voiceCaption: 'Spoken description',
      aiCaptionsByPhotoId: fullAiMap,
      photos,
    });

    expect(result.source).toBe('smart-merge');
    expect(result.finalCaption).toBe(
      'Spoken description\n\nFirst photo AI caption.\n\nSecond photo AI caption.',
    );
  });

  it('uses voice only when AI is missing', () => {
    const result = buildFinalCaption({
      manualCaption: '',
      voiceCaption: 'Spoken description only',
      aiCaptionsByPhotoId: {},
      photos,
    });

    expect(result).toEqual<BuildFinalCaptionResult>({
      finalCaption: 'Spoken description only',
      source: 'voice',
    });
  });

  it('uses AI only when voice is missing', () => {
    const result = buildFinalCaption({
      manualCaption: '',
      voiceCaption: '',
      aiCaptionsByPhotoId: fullAiMap,
      photos,
    });

    expect(result).toEqual<BuildFinalCaptionResult>({
      finalCaption: 'First photo AI caption.\n\nSecond photo AI caption.',
      source: 'ai',
    });
  });

  it('returns empty caption and "none" source when everything is empty', () => {
    const result = buildFinalCaption({
      manualCaption: '',
      voiceCaption: '',
      aiCaptionsByPhotoId: {},
      photos,
    });

    expect(result).toEqual<BuildFinalCaptionResult>({
      finalCaption: '',
      source: 'none',
    });
  });

  it('handles partial AI coverage across multiple photos', () => {
    const partialAiMap = {
      p1: 'Caption for first only.',
    };

    const result = buildFinalCaption({
      manualCaption: '',
      voiceCaption: 'Voice description',
      aiCaptionsByPhotoId: partialAiMap,
      photos,
    });

    expect(result.source).toBe('smart-merge');
    expect(result.finalCaption).toBe(
      'Voice description\n\nCaption for first only.',
    );
  });
});