import { isDirectoryVisible } from '../liveDirectory';

describe('liveDirectory', () => {
  it('shows streams when directoryReady is true or unset', () => {
    expect(isDirectoryVisible({ directoryReady: true })).toBe(true);
    expect(isDirectoryVisible({})).toBe(true);
  });

  it('hides streams when directoryReady is false', () => {
    expect(isDirectoryVisible({ directoryReady: false })).toBe(false);
  });
});
