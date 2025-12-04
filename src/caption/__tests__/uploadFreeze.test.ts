import { CaptionOrchestrator } from '../orchestrator';
import { createPhotoKey } from '../utils';
import { NormalizedPhoto } from '../types';

function makePhoto(id: string): NormalizedPhoto {
  return {
    photoKey: createPhotoKey(id),
    uri: `file://${id}.jpg`,
  };
}

describe('Caption freeze behavior', () => {
  it('reuses frozenCaption on retry and ignores later AI changes', () => {
    const photo = makePhoto('p1');
    const orchestrator = new CaptionOrchestrator({ initialPhotos: [photo] });

    // Initial AI caption.
    const attempt1 = orchestrator.beginAiCaptionForPhoto(photo.photoKey);
    orchestrator.completeAiCaptionForPhoto(photo.photoKey, attempt1, 'First AI');

    const previewBeforeFreeze = orchestrator.getPreviewCaption();
    const frozen1 = orchestrator.computeFinalCaption();

    expect(previewBeforeFreeze).toBe(frozen1);

    // Later AI finishes with a different caption (should not change frozen).
    const attempt2 = orchestrator.beginAiCaptionForPhoto(photo.photoKey);
    orchestrator.completeAiCaptionForPhoto(photo.photoKey, attempt2, 'Second AI');

    const frozen2 = orchestrator.computeFinalCaption();
    const previewAfterFreeze = orchestrator.getPreviewCaption();

    expect(frozen2).toBe(frozen1);
    expect(previewAfterFreeze).toBe(frozen1);
  });

  it('voice edits after freeze do not affect frozenCaption', () => {
    const photo = makePhoto('p1');
    const orchestrator = new CaptionOrchestrator({ initialPhotos: [photo] });

    const attempt = orchestrator.beginAiCaptionForPhoto(photo.photoKey);
    orchestrator.completeAiCaptionForPhoto(photo.photoKey, attempt, 'AI caption');

    const frozen = orchestrator.computeFinalCaption();

    // User changes voice caption after freeze.
    orchestrator.setVoiceCaption('New voice caption');

    const preview = orchestrator.getPreviewCaption();
    const frozenAgain = orchestrator.computeFinalCaption();

    expect(preview).toBe(frozen);
    expect(frozenAgain).toBe(frozen);
  });
});