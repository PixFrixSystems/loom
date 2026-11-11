import type { LoomApi } from './index'

declare global {
  interface Window {
    loom: LoomApi
  }
}

export {}
