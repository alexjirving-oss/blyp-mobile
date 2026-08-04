import { AppState, type AppStateStatus } from 'react-native'

let currentUser: unknown = null

export function setAuthenticatedUser(user: unknown) {
    currentUser = user
    console.log('[AUTH] USER_SET', !!user)
}

export function getAuthenticatedUser() {
    return currentUser
}

export function clearAuthenticatedUser() {
    currentUser = null
    console.log('[AUTH] USER_CLEARED')
}

export function installAuthLifecycleMonitor(onExpire?: () => void) {
    AppState.addEventListener('change', (state: AppStateStatus) => {
        if (state === 'active') {
            if (!currentUser) {
                console.warn('[AUTH] SESSION_MISSING')
                onExpire?.()
            }
        }
    })
}
