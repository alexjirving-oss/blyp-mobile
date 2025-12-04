import { CaptionOrchestrator } from '../orchestrator';
import { createPhotoKey } from '../utils';
import {
  CaptionState,
  NormalizedPhoto,
  UiComposerState,
} from '../types';

function makePhoto(id: string): NormalizedPhoto {
  return {
    photoKey: createPhotoKey(id),
    uri: `file://${id}.jpg`,
  };
}

describe('CaptionOrchestrator', () => {
  it('increments attemptId and ignores stale AI responses', () => {
    const photo = makePhoto('p1');
    const orchestrator = new CaptionOrchestrator({ initialPhotos: [photo] });

    const attempt1 = orchestrator.beginAiCaptionForPhoto(photo.photoKey);
    const attempt2 = orchestrator.beginAiCaptionForPhoto(photo.photoKey);

    expect(attempt2).toBeGreaterThan(attempt1);

    // Stale attempt1 result should be ignored.
    orchestrator.completeAiCaptionForPhoto(photo.photoKey, attempt1, 'stale');
    orchestrator.completeAiCaptionForPhoto(photo.photoKey, attempt2, 'fresh');

    const state: UiComposerState = orchestrator.getUiState();
    const entry = state.aiCaptions[photo.photoKey];

    expect(entry.attemptId).toBe(attempt2);
    expect(entry.text).toBe('fresh');
  });

  it('derives captionState from per-photo machines', () => {
    const p1 = makePhoto('a');
    const p2 = makePhoto('b');
    const orchestrator = new CaptionOrchestrator({ initialPhotos: [p1, p2] });

    // Start AI for both photos → generating
    const a1 = orchestrator.beginAiCaptionForPhoto(p1.photoKey);
    const b1 = orchestrator.beginAiCaptionForPhoto(p2.photoKey);

    let captionState: CaptionState = orchestrator.getCaptionState();
    expect(captionState.state).toBe('generating');

    // Complete first photo → still generating (second still requesting)
    orchestrator.completeAiCaptionForPhoto(p1.photoKey, a1, 'One');
    captionState = orchestrator.getCaptionState();
    expect(captionState.state).toBe('generating');

    // Complete second photo → ready
    orchestrator.completeAiCaptionForPhoto(p2.photoKey, b1, 'Two');
    captionState = orchestrator.getCaptionState();
    expect(captionState.state).toBe('ready');
  });

  it('sets captionState to error on hard failure', () => {
    const photo = makePhoto('p1');
    const orchestrator = new CaptionOrchestrator({ initialPhotos: [photo] });

    orchestrator.markHardError('network down');

    const captionState = orchestrator.getCaptionState();
    expect(captionState.state).toBe('error');
  });

  it('preview correctness matches final caption prior to freeze', () => {
    const photo = makePhoto('p1');
    const orchestrator = new CaptionOrchestrator({ initialPhotos: [photo] });

    const attempt = orchestrator.beginAiCaptionForPhoto(photo.photoKey);
    orchestrator.completeAiCaptionForPhoto(photo.photoKey, attempt, 'AI caption');

    const preview = orchestrator.getPreviewCaption();
    const frozen = orchestrator.computeFinalCaption();

    expect(preview).toBe(frozen);
  });
});