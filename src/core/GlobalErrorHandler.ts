export function installGlobalErrorHandlers() {
    const log = (type: string, data: any) => {
        console.error('[RUNTIME]', type, data)
    }

    const g: any = globalThis as any

    const originalHandler = g?.ErrorUtils?.getGlobalHandler?.()

    g?.ErrorUtils?.setGlobalHandler?.((error: any, isFatal: boolean) => {
        log('JS_FATAL', { message: error?.message, stack: error?.stack, isFatal })
        originalHandler?.(error, isFatal)
    })

    const origCatch = (Promise.prototype as any).catch
        ; (Promise.prototype as any).catch = function (handler: any) {
            return origCatch.call(this, (err: any) => {
                log('PROMISE_REJECTION', err)
                return handler?.(err)
            })
        }
}
