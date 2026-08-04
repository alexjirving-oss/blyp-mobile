export function checkTokenExpiry(exp: number, onExpired?: () => void) {
    const now = Math.floor(Date.now() / 1000)
    if (exp <= now) {
        console.warn('[AUTH] TOKEN_EXPIRED')
        onExpired?.()
    }
}
