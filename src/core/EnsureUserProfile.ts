import { createUserProfile, loadUserProfile } from './UserProfileService'

export async function ensureUserProfile(userId: string) {
    try {
        return await loadUserProfile(userId)
    } catch {
        console.warn('[PROFILE] MISSING_CREATING')
        return await createUserProfile(userId)
    }
}
