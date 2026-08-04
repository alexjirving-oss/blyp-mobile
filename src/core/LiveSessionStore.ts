import { LiveSession } from './LiveSessionModel'
import { notifyLiveStarted } from './LiveStartNotificationHelper'

let activeSessions: Record<string, LiveSession> = {}

export function startLiveSession(hostId: string) {
    const session: LiveSession = {
        id: Math.random().toString(),
        hostId,
        startedAt: Date.now(),
    }
    activeSessions[session.id] = session

    // best-effort: allow callers to optionally pass followerIds/hostName without
    // changing the return shape or breaking existing logic.
    try {
        const anyArgs = arguments as any
        const followerIds = anyArgs?.[1]
        const hostName = anyArgs?.[2]

        if (Array.isArray(followerIds)) {
            followerIds.forEach((fid: any) => {
                try {
                    notifyLiveStarted(String(fid), String(hostName ?? hostId))
                } catch { }
            })
        }
    } catch { }

    return session
}

export function endLiveSession(sessionId: string) {
    const s = activeSessions[sessionId]
    if (s) {
        s.endedAt = Date.now()
        delete activeSessions[sessionId]
    }
}

export function getLiveSession(sessionId: string) {
    return activeSessions[sessionId]
}
