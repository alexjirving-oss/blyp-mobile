import type { UserProfile } from './UserProfileModel'

let profile: UserProfile | null = null

export function setUserProfile(p: UserProfile) {
    profile = p
    console.log('[PROFILE] SET', p?.id)
}

export function getUserProfile() {
    return profile
}

export function clearUserProfile() {
    profile = null
    console.log('[PROFILE] CLEARED')
}
