import type { VeronicaApi } from '@shared/types'

declare global {
  interface Window {
    veronica: VeronicaApi
  }
}

export {}
