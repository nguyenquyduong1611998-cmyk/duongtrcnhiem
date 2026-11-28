import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return { 
   
base: process.env.VITE_FIREBASE_ENV === 'staging'
  ? '/'
  : '/duongtrcnhiem/',

    plugins: [
      react(),
      tailwindcss(),
      // Temporary, non-sensitive build probe for Phase 6D Preview diagnosis.
      // Logs only boolean checks and string lengths, never raw env values.
      {
        name: 'phase6d-build-env-probe',
        apply: 'build',
        configResolved(config): void {
          const key = 'VITE_PHASE6_STUDENT_TIMED_UI';
          const describe = (value: unknown) => ({
            present: value !== undefined,
            type: typeof value,
            exactTrue: value === 'true',
            trimmedTrue: typeof value === 'string' && value.trim() === 'true',
            length: typeof value === 'string' ? value.length : null,
          });
          const names = Object.keys(process.env);
          const nearKeys = names.filter(name =>
            name.replace(/[\u200B-\u200D\uFEFF]/g, '').trim() === key);
          // Cloudflare's build-log panel clips long lines and has no horizontal
          // scrollbar. Emit three short, safe lines without any raw env values.
          const processFlag = describe(process.env[key]);
          const viteFlag = describe(config.env[key]);
          const logFlag = (label: string, info: ReturnType<typeof describe>) => {
            console.info('[p6d-' + label + '] present=' + info.present +
              ' type=' + info.type + ' exact=' + info.exactTrue +
              ' trimmed=' + info.trimmedTrue + ' length=' + info.length);
          };
          logFlag('process', processFlag);
          logFlag('vite', viteFlag);
          console.info('[p6d-keys] exactKeyFound=' +
            Object.prototype.hasOwnProperty.call(process.env, key) +
            ' nearMatchCount=' + nearKeys.length);
        },
      },
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
