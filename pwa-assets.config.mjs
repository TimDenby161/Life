import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Regenerate icons with: npx pwa-assets-generator
export default defineConfig({
  preset: { ...minimal2023Preset, maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#312e81' } }, apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#312e81' } } },
  images: ['public/favicon.svg'],
})
