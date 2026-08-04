// StreamSegmentsAdapter: unified read abstraction for segments during migration
// Uses subcollection when present; falls back to legacy map to preserve stability.
// Does not modify playback component yet (non-invasive incremental adoption).

import { db } from '../config/firebase';
import { snapExists } from '../utils/firestoreSnap';

class StreamSegmentsAdapter {
  async getWindow(streamId, windowSize = 5) {
    try {
      const streamRef = db.collection('liveStreams').doc(streamId);
      // Prefer subcollection
      const segSnap = await streamRef.collection('segments').get();
      if (!segSnap.empty) {
        const ordered = segSnap.docs.map(d => d.data()).sort((a,b) => (a.number||0)-(b.number||0));
        return ordered.slice(-windowSize).map(s => ({ ...s, source: 'subcollection' }));
      }
      // Fallback legacy map
      const docSnap = await streamRef.get();
      if (!snapExists(docSnap)) return [];
      const data = docSnap.data() || {};
      const curr = data.currentSegment;
      const out = [];
      for (let i = Math.max(0, curr - windowSize + 1); i <= curr; i++) {
        const seg = data.segments?.[i];
        if (seg) out.push({ ...seg, number: i, source: 'legacyMap' });
      }
      return out;
    } catch (e) {
      console.warn('⚠️ StreamSegmentsAdapter.getWindow error:', e?.message);
      return [];
    }
  }

  async getLatest(streamId) {
    const win = await this.getWindow(streamId, 1);
    return win.length ? win[0] : null;
  }
}

export default new StreamSegmentsAdapter();
