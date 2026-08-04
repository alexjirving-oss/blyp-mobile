import { safeFetch } from './NetworkLogger'
import { setUserProfile } from './UserProfileCache'
import type { UserProfile } from './UserProfileModel'

export async function loadUserProfile(userId: string) {
    const res = await safeFetch('/api/profile/' + userId)
    const data = (await res.json()) as UserProfile
    setUserProfile(data)
    return data
}

export async function createUserProfile(userId: string) {
    const res = await safeFetch('/api/profile/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
    })
    const data = (await res.json()) as UserProfile
    setUserProfile(data)
    return data
}
