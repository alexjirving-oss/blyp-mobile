import { computePostLikeNext } from '../src/services/LikeService';

describe('computePostLikeNext', () => {
  const uid = 'user-abc';

  it('likes from empty baseline', () => {
    const next = computePostLikeNext({}, uid);
    expect(next.liked).toBe(true);
    expect(next.count).toBe(1);
    expect(next.payload).toEqual({ likedBy: [uid], likes: 1, likeCount: 1 });
  });

  it('unlikes when already liked', () => {
    const next = computePostLikeNext({ likes: 1, likeCount: 1, likedBy: [uid] }, uid);
    expect(next.liked).toBe(false);
    expect(next.count).toBe(0);
    expect(next.payload.likedBy).toEqual([]);
  });

  it('coerces float counters to int baseline', () => {
    const next = computePostLikeNext({ likes: 3.9, likeCount: 2, likedBy: [] }, uid);
    expect(next.count).toBe(4);
    expect(Number.isInteger(next.payload.likes)).toBe(true);
  });

  it('uses higher of likes and likeCount as baseline', () => {
    const next = computePostLikeNext({ likes: 2, likeCount: 5, likedBy: [] }, uid);
    expect(next.count).toBe(6);
  });
});
