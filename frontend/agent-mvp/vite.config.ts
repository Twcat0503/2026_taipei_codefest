import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  css: { postcss: { plugins: [] } },
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: ['.', '../../tools/townpass', '../../assets/svg'] },
  },
});
