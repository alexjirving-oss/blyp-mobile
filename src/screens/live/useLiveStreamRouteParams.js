/**
 * Normalizes LiveStream navigation params (handles nested `params.params` from some navigators).
 */
export function unwrapLiveRouteParams(maybeParams) {
  let current = maybeParams;
  for (let i = 0; i < 4; i++) {
    if (!current || typeof current !== 'object') {
      return {};
    }
    if (
      Object.prototype.hasOwnProperty.call(current, 'mode') ||
      Object.prototype.hasOwnProperty.call(current, 'streamId') ||
      Object.prototype.hasOwnProperty.call(current, 'hostUid')
    ) {
      return current;
    }
    if (current.params && typeof current.params === 'object') {
      current = current.params;
      continue;
    }
    return current;
  }
  return current && typeof current === 'object' ? current : {};
}

export function useLiveStreamRouteParams(route) {
  const safeRoute = route || {};
  const normalizedParams = unwrapLiveRouteParams(safeRoute.params || {});

  const routeMode =
    typeof normalizedParams.mode === 'string' && normalizedParams.mode.length > 0
      ? normalizedParams.mode.trim().toLowerCase()
      : null;

  const routeHostUid =
    typeof normalizedParams.hostUid === 'string' && normalizedParams.hostUid.trim().length > 0
      ? normalizedParams.hostUid.trim()
      : null;

  const routeStreamId =
    typeof normalizedParams.streamId === 'string' && normalizedParams.streamId.trim().length > 0
      ? normalizedParams.streamId.trim()
      : null;

  const routeHostDisplayName =
    typeof normalizedParams.hostDisplayName === 'string' && normalizedParams.hostDisplayName.trim().length > 0
      ? normalizedParams.hostDisplayName.trim()
      : null;

  const routeSource =
    typeof normalizedParams.source === 'string' && normalizedParams.source.trim().length > 0
      ? normalizedParams.source.trim()
      : null;

  const routeE2EAutoStart =
    normalizedParams.e2eAutoStart === true ||
    normalizedParams.e2eAutoStart === '1' ||
    normalizedParams.e2eAutoStart === 1;

  const routeE2ETitle =
    typeof normalizedParams.e2eTitle === 'string' && normalizedParams.e2eTitle.trim().length > 0
      ? normalizedParams.e2eTitle.trim()
      : null;

  const routeBattleId =
    typeof normalizedParams.battleId === 'string' && normalizedParams.battleId.trim().length > 0
      ? normalizedParams.battleId.trim()
      : null;

  const routeBattleRole =
    normalizedParams.battleRole === 'creator' || normalizedParams.battleRole === 'opponent'
      ? normalizedParams.battleRole
      : null;

  const routeBattleSessionId =
    typeof normalizedParams.battleSessionId === 'string' && normalizedParams.battleSessionId.trim().length > 0
      ? normalizedParams.battleSessionId.trim()
      : null;

  const isBattleParticipant = !!routeBattleId && !!routeBattleRole;

  return {
    normalizedParams,
    routeMode,
    routeHostUid,
    routeStreamId,
    routeHostDisplayName,
    routeSource,
    routeE2EAutoStart,
    routeE2ETitle,
    routeBattleId,
    routeBattleRole,
    routeBattleSessionId,
    isBattleParticipant,
  };
}
