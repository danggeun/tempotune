declare module 'virtual:pwa-register' {
  export interface RegisterSWOptions { immediate?: boolean; onNeedRefresh?: () => void; onOfflineReady?: () => void; onRegisteredSW?: (url: string, r?: ServiceWorkerRegistration) => void; onRegisterError?: (e: unknown) => void }
  export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>
}
