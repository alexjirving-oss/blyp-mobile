import { mergeCaptionSmartMode } from '../captionMergePolicy';
import type { BuildFinalCaptionResult } from '../buildFinalCaption';

const photos = [{ id: 'p1' }, { id: 'p2' }];

describe('mergeCaptionSmartMode', () => {
  it('merges voice + AI with voice first, separated by a blank line', () => {
    const result = mergeCaptionSmartMode({
      voiceCaption: 'Spoken description',
      aiCaptionsByPhotoId: {
        p1: 'First AI caption',
        p2: 'Second AI caption',
      },
      photos,
    });

    expect(result).toEqual<BuildFinalCaptionResult>({
      finalCaption:
        'Spoken description\n\nFirst AI caption\n\nSecond AI caption',
      source: 'smart-merge',
    });
  });

  it('returns voice-only when AI is empty', () => {
    const result = mergeCaptionSmartMode({
      voiceCaption: 'Spoken only',
      aiCaptionsByPhotoId: {},
      photos,
    });

    expect(result).toEqual<BuildFinalCaptionResult>({
      finalCaption: 'Spoken only',
      source: 'voice',
    });
  });

  it('returns AI-only when voice is empty', () => {
    const result = mergeCaptionSmartMode({
      voiceCaption: '',
      aiCaptionsByPhotoId: {
        p1: 'Only AI caption',
      },
      photos,
    });

    expect(result).toEqual<BuildFinalCaptionResult>({
      finalCaption: 'Only AI caption',
      source: 'ai',
    });
  });

  it('returns empty and "none" when both voice and AI are missing', () => {
    const result = mergeCaptionSmartMode({
      voiceCaption: '',
      aiCaptionsByPhotoId: {},
      photos,
    });

    expect(result).toEqual<BuildFinalCaptionResult>({
      finalCaption: '',
      source: 'none',
    });
  });

  it('respects photo ordering when merging AI captions', () => {
    const shuffledPhotos = [{ id: 'p2' }, { id: 'p1' }];

    const result = mergeCaptionSmartMode({
      voiceCaption: '',
      aiCaptionsByPhotoId: {
        p1: 'Caption for p1',
        p2: 'Caption for p2',
      },
      photos: shuffledPhotos,
    });

    expect(result.source).toBe('ai');
    expect(result.finalCaption).toBe('Caption for p2\n\nCaption for p1');
  });
});