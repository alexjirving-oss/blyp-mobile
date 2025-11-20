// PlaylistFetchService: fetch HLS master and quality playlists from Firebase Storage.
// Transitional remote access: assumes functions wrote playlists to streams/<streamId>/playlists/.
// Uses Firebase storage wrapper; callers handle parsing.

import { storage } from '../config/firebase';

class PlaylistFetchService {
  _getRef(path) {
    try {
      return storage?.ref?.(path) || storage?.ref(path); // compat vs modular guard
    } catch {
      return null;
    }
  }

  async getDownloadURL(path) {
    const ref = this._getRef(path);
    if (!ref) throw new Error('Storage unavailable');
    return ref.getDownloadURL();
  }

  async fetchText(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  async getMaster(streamId) {
    const path = `streams/${streamId}/playlists/master.m3u8`;
    try {
      const url = await this.getDownloadURL(path);
      return await this.fetchText(url);
    } catch (e) {
      console.warn('Master playlist fetch failed', e?.message);
      return '';
    }
  }

  async getQuality(streamId, quality) {
    const path = `streams/${streamId}/playlists/${quality}.m3u8`;
    try {
      const url = await this.getDownloadURL(path);
      return await this.fetchText(url);
    } catch (e) {
      console.warn('Quality playlist fetch failed', quality, e?.message);
      return '';
    }
  }
}

export default new PlaylistFetchService();
