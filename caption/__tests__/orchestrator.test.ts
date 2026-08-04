import {
  freezeCaption,
  getPreviewCaption,
  type CaptionState,
} from '../orchestrator';

type TestPhoto = { id: string };

const baseState: CaptionState<TestPhoto> = {
  photos: [{ id: 'p1' }, { id: 'p2' }],
  manualCaption: '',
  voiceCaption: '',
  aiCaptionsByPhotoId: {},
  frozenCaption: null,
  frozenCaptionSource: null,
};

describe('caption orchestrator - preview + freeze', () => {
  it('preview uses smart merge when not frozen', () => {
    const state: CaptionState<TestPhoto> = {
      ...baseState,
      voiceCaption: 'Spoken description',
      aiCaptionsByPhotoId: {
        p1: 'First AI caption',
        p2: 'Second AI caption',
      },
    };

    const preview = getPreviewCaption(state);

    expect(preview.source).toBe('smart-merge');
    expect(preview.finalCaption).toBe(
      'Spoken description\n\nFirst AI caption\n\nSecond AI caption',
    );
  });

  it('preview uses manual caption when present', () => {
    const state: CaptionState<TestPhoto> = {
      ...baseState,
      manualCaption: 'My edited caption',
      voiceCaption: 'Spoken description',
      aiCaptionsByPhotoId: {
        p1: 'First AI caption',
      },
    };

    const preview = getPreviewCaption(state);

    expect(preview.source).toBe('manual');
    expect(preview.finalCaption).toBe('My edited caption');
  });

  it('freezeCaption stores the smart-merged caption and source', () => {
    const state: CaptionState<TestPhoto> = {
      ...baseState,
      voiceCaption: 'Spoken description',
      aiCaptionsByPhotoId: {
        p1: 'First AI caption',
      },
    };

    const frozenState = freezeCaption(state);

    expect(frozenState.frozenCaption).toBe(
      'Spoken description\n\nFirst AI caption',
    );
    expect(frozenState.frozenCaptionSource).toBe('smart-merge');
  });

  it('freezeCaption is idempotent (does not recompute when already frozen)', () => {
    const firstFrozen = freezeCaption({
      ...baseState,
      voiceCaption: 'Voice at freeze time',
      aiCaptionsByPhotoId: {
        p1: 'AI at freeze time',
      },
    });

    // Mutate the non-frozen fields as if user kept editing,
    // frozen caption must remain unchanged.
    const mutatedAfterFreeze: CaptionState<TestPhoto> = {
      ...firstFrozen,
      manualCaption: 'User manual after freeze',
      voiceCaption: 'New voice',
      aiCaptionsByPhotoId: {
        p1: 'New AI',
      },
    };

    const secondFrozen = freezeCaption(mutatedAfterFreeze);

    expect(secondFrozen.frozenCaption).toBe(firstFrozen.frozenCaption);
    expect(secondFrozen.frozenCaptionSource).toBe(
      firstFrozen.frozenCaptionSource,
    );
  });

  it('preview uses frozen caption once it exists', () => {
    const frozen = freezeCaption({
      ...baseState,
      voiceCaption: 'Voice to freeze',
      aiCaptionsByPhotoId: {
        p1: 'AI to freeze',
      },
    });

    const preview = getPreviewCaption({
      ...frozen,
      // Any further edits should not affect preview because it is frozen.
      manualCaption: 'Manual after freeze',
      voiceCaption: 'Voice after freeze',
      aiCaptionsByPhotoId: {
        p1: 'AI after freeze',
      },
    });

    expect(preview.finalCaption).toBe(frozen.frozenCaption);
    expect(preview.source).toBe(frozen.frozenCaptionSource);
  });
});