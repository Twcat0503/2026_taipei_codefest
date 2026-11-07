/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google Maps JavaScript API key；未設定時地圖區塊顯示替代訊息 */
  readonly VITE_GOOGLE_MAPS_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
