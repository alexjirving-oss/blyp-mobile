export async function safeFetch(url: string, options?: RequestInit) {
    try {
        const res = await fetch(url, options)
        if (!res.ok) {
            console.error('[NETWORK_FAIL]', url, res.status)
        }
        return res
    } catch (err) {
        console.error('[NETWORK_ERROR]', url, err)
        throw err
    }
}
