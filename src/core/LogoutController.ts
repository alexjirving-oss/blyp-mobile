import { clearAuthenticatedUser } from './AuthStateManager'

export function forceLogout(navigation: any) {
    clearAuthenticatedUser()
    navigation.reset({
        index: 0,
        routes: [{ name: 'WelcomeScreen' }],
    })
    console.log('[AUTH] FORCED_LOGOUT')
}
