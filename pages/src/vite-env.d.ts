/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ANILIST_CLIENT_ID: string
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
  readonly VITE_DAILYMOTION_PLAYER_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv & { readonly BASE_URL: string }
}

declare module 'hls.js/light' {
  import Hls from 'hls.js'
  export default Hls
}
