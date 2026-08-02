/**
 * Fake-follower utilities are permanently disabled in production builds.
 * Kept as stubs so any stale imports fail closed instead of minting data.
 */

export const addFakeFollowers = async (_targetUserId, _count = 1000) => {
  return { success: false, error: 'FAKE_FOLLOWERS_DISABLED' };
};

export const getCurrentFollowerCount = async (_userId) => 0;

export const removeFakeFollowers = async (_targetUserId) => {
  return { success: false, error: 'FAKE_FOLLOWERS_DISABLED' };
};
