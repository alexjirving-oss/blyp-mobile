const mockUseAuth = jest.fn();
const mockGetAdminAccess = jest.fn();

jest.mock('../src/hooks/useCommon', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('../src/api/adminLiveApi', () => ({
  getAdminAccess: (...args) => mockGetAdminAccess(...args),
}));

const React = require('react');
const TestRenderer = require('react-test-renderer');
const { act } = TestRenderer;
const useIsAdminModule = require('../src/hooks/useIsAdmin');
const useIsAdmin = useIsAdminModule.default;
const { clearAdminAccessCache, normalizeAdminAccess } = useIsAdminModule;

global.IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ onValue }) {
  const value = useIsAdmin();
  React.useEffect(() => {
    onValue(value);
  }, [onValue, value.isAdmin, value.loading, value.role, value.permissions]);
  return null;
}

describe('useIsAdmin', () => {
  beforeEach(() => {
    clearAdminAccessCache();
    mockUseAuth.mockReset();
    mockGetAdminAccess.mockReset();
  });

  it('waits for Cognito and then accepts server-authoritative owner access', async () => {
    const alexUid = '26522274-e001-70aa-51b6-bcbbdffc43bb';
    let authState = { uid: null, authReady: false, isAuthenticated: false };
    mockUseAuth.mockImplementation(() => authState);
    mockGetAdminAccess.mockResolvedValue({
      ok: true,
      actorUserId: alexUid,
      role: 'owner',
      permissions: ['growth.feed_priority', 'content.moderate', 'users.ban'],
      staffSource: 'bootstrap',
    });
    let latest = null;
    const onValue = (value) => { latest = value; };
    let tree;

    await act(async () => {
      tree = TestRenderer.create(<Probe onValue={onValue} />);
    });
    expect(latest.loading).toBe(true);
    expect(latest.isAdmin).toBe(false);
    expect(mockGetAdminAccess).not.toHaveBeenCalled();

    authState = { uid: alexUid, authReady: true, isAuthenticated: true };
    await act(async () => {
      tree.update(<Probe onValue={onValue} />);
      await Promise.resolve();
    });

    expect(mockGetAdminAccess).toHaveBeenCalledTimes(1);
    expect(latest.loading).toBe(false);
    expect(latest.isAdmin).toBe(true);
    expect(latest.role).toBe('owner');
    expect(latest.hasPermission('growth.feed_priority')).toBe(true);
    await act(async () => {
      tree.unmount();
    });
  });

  it('fails closed when the server rejects a normal user', async () => {
    mockUseAuth.mockReturnValue({
      uid: '11111111-1111-4111-8111-111111111111',
      authReady: true,
      isAuthenticated: true,
    });
    mockGetAdminAccess.mockRejectedValue(Object.assign(new Error('FORBIDDEN'), { status: 403 }));
    let latest = null;
    let tree;

    await act(async () => {
      tree = TestRenderer.create(<Probe onValue={(value) => { latest = value; }} />);
      await Promise.resolve();
    });

    expect(latest.loading).toBe(false);
    expect(latest.isAdmin).toBe(false);
    expect(latest.hasPermission('growth.feed_priority')).toBe(false);
    await act(async () => {
      tree.unmount();
    });
  });

  it('rejects an entitlement payload for a different Cognito subject', () => {
    expect(normalizeAdminAccess({
      ok: true,
      actorUserId: '267272c4-e041-70d2-f112-3d309424c968',
      role: 'admin',
      permissions: ['growth.feed_priority'],
    }, '26522274-e001-70aa-51b6-bcbbdffc43bb')).toMatchObject({
      isAdmin: false,
      role: null,
      permissions: [],
    });
  });
});
