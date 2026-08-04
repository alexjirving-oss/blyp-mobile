const devices: Record<string, string[]> = {}

export function registerDevice(userId: string, deviceId: string) {
    if (!devices[userId]) devices[userId] = []
    if (!devices[userId].includes(deviceId)) {
        devices[userId].push(deviceId)
    }
}

export function getUserDevices(userId: string): string[] {
    return devices[userId] || []
}
