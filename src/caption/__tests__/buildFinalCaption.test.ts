import { buildFinalCaption } from '../buildFinalCaption';
import { createPhotoKey } from '../utils';
import {
  AiCaptionMap,
  BuildFinalCaptionInput,
  NormalizedPhoto,
} from '../types';

function makePhoto(id: string): NormalizedPhoto {
  return {
    photoKey: createPhotoKey(id),
    uri: `file://${id}.jpg`,
  };
}

describe('buildFinalCaption', () => {
  it('uses voice caption when non-empty and ignores AI', () => {
    const photos = [makePhoto('p1')];
    const aiCaptions: AiCaptionMap = {
      [photos[0].photoKey]: { attemptId: 1, text: 'AI caption' },
    } as AiCaptionMap;

    const input: BuildFinalCaptionInput = {
      photos,
      aiCaptions,
      voiceCaption: '  My voice caption  ',
    };

    const result = buildFinalCaption(input);

    expect(result.finalCaption).toBe('My voice caption');
    expect(result.source).toBe('voice');
  });

  it('uses single-photo AI caption when voice is empty', () => {
    const photos = [makePhoto('p1')];
    const aiCaptions: AiCaptionMap = {
      [photos[0].photoKey]: { attemptId: 1, text: '  AI caption  ' },
    } as AiCaptionMap;

    const input: BuildFinalCaptionInput = {
      photos,
      aiCaptions,
      voiceCaption: null,
    };

    const result = buildFinalCaption(input);

    expect(result.finalCaption).toBe('AI caption');
    expect(result.source).toBe('ai');
  });

  it('merges multi-photo AI captions in photo order and skips empties', () => {
    const photos = [makePhoto('a'), makePhoto('b'), makePhoto('c')];

    const aiCaptions: AiCaptionMap = {
      [photos[0].photoKey]: { attemptId: 1, text: 'First' },
      [photos[1].photoKey]: { attemptId: 1, text: '   ' }, // empty
      [photos[2].photoKey]: { attemptId: 1, text: 'Third' },
    } as AiCaptionMap;

    const input: BuildFinalCaptionInput = {
      photos,
      aiCaptions,
      voiceCaption: null,
    };

    const result = buildFinalCaption(input);

    expect(result.finalCaption).toBe('First\nThird');
    expect(result.source).toBe('ai');
  });

  it('applies fallback to empty string when voice and AI are empty', () => {
    const photos = [makePhoto('p1')];
    const aiCaptions: AiCaptionMap = {
      [photos[0].photoKey]: { attemptId: 1, text: '   \n\n  ' },
    } as AiCaptionMap;

    const input: BuildFinalCaptionInput = {
      photos,
      aiCaptions,
      voiceCaption: '   ',
    };

    const result = buildFinalCaption(input);

    expect(result.finalCaption).toBe('');
    expect(result.source).toBe('none');
  });

  it('reflects photo reorder in merged AI caption order', () => {
    const p1 = makePhoto('a');
    const p2 = makePhoto('b');

    const aiCaptions: AiCaptionMap = {
      [p1.photoKey]: { attemptId: 1, text: 'One' },
      [p2.photoKey]: { attemptId: 1, text: 'Two' },
    } as AiCaptionMap;

    const input1: BuildFinalCaptionInput = {
      photos: [p1, p2],
      aiCaptions,
      voiceCaption: null,
    };

    const input2: BuildFinalCaptionInput = {
      photos: [p2, p1],
      aiCaptions,
      voiceCaption: null,
    };

    const res1 = buildFinalCaption(input1);
    const res2 = buildFinalCaption(input2);

    expect(res1.finalCaption).toBe('One\nTwo');
    expect(res2.finalCaption).toBe('Two\nOne');
  });
});