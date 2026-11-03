import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// "Open index.html from disk" build (file://): one classic (non-module) script, no crossorigin attributes — browsers refuse module scripts
// and fetch() on file:// pages. The content files are converted to <path>.js by scripts/make-file-bundle.mjs.
const classicScripts = (): Plugin => ({
  name: 'classic-scripts',
  transformIndexHtml: { order: 'post', handler: (html) => html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/, '').replace(/<\/body>/, '<script defer src="$SRC"></script></body>').replace(/ crossorigin/g, '').replace('</head>', '<meta name="bahad-content" content="script" /></head>') },
});
// the script tag is re-inserted at the end of the body (the classic script reads #root immediately)
const withSrc = (): Plugin => ({
  name: 'classic-script-src',
  enforce: 'post',
  generateBundle(_o, bundle) {
    const entry = Object.values(bundle).find((c) => c.type === 'chunk' && c.isEntry);
    const html = bundle['index.html'];
    if (entry && html && html.type === 'asset') html.source = String(html.source).replace('$SRC', `./${entry.fileName}`);
  },
});

export default defineConfig({
  plugins: [react(), classicScripts(), withSrc()],
  base: './',
  build: {
    outDir: 'dist-file', sourcemap: false, target: 'es2022', cssCodeSplit: false, modulePreload: false,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true, entryFileNames: 'assets/app.js', assetFileNames: 'assets/[name]-[hash][extname]' } },
  },
});
