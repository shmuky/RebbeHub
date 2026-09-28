import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { reactRouter } from '@react-router/dev/vite';
import { defineConfig, type Plugin } from 'vite';

const src = (pkg: string) => fileURLToPath(new URL(`../../packages/${pkg}/src/index.ts`, import.meta.url));

// Resolved by Node's own module resolution: pdfjs-dist is hoisted to the workspace root.
const pdfjsDistRoot = path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'));

/**
 * The reader's pdf.js assets, at stable unhashed URLs (public/pdf-*): pdf.js
 * fetches them by filename appended to a base URL, not as modules. As in
 * Sichos-Kodesh's apps/web/vite.config.ts, from which this is taken: the
 * wasm image codecs (JBig2 and JPEG2000 scans render blank without them)
 * and colour management, cmaps and the standard fonts. The PDF JavaScript
 * interpreter is left out on purpose: embedded PDF scripts never run.
 */
function copyPdfAssets(): Plugin {
  const dirs = [
    { from: 'wasm', to: 'pdf-wasm', only: ['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm'] },
    { from: 'cmaps', to: 'pdf-cmaps' },
    { from: 'standard_fonts', to: 'pdf-standard-fonts' },
  ];
  const copy = () => {
    for (const { from, to, only } of dirs) {
      const source = path.join(pdfjsDistRoot, from);
      const dest = path.resolve(import.meta.dirname, 'public', to);
      if (!existsSync(source)) continue;
      mkdirSync(dest, { recursive: true });
      if (only) for (const file of only) cpSync(path.join(source, file), path.join(dest, file));
      else cpSync(source, dest, { recursive: true });
    }
  };
  return { name: 'copy-pdf-assets', buildStart: copy, configureServer: copy };
}

export default defineConfig({
  plugins: [copyPdfAssets(), reactRouter()],
  // The shared packages are used from source, so nothing needs building first.
  resolve: { alias: { '@rebbehub/hebrew': src('hebrew'), '@rebbehub/model': src('model') } },
  server: { port: 5173 },
});
