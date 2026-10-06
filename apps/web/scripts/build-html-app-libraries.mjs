import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'vite';

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDirectory = join(webRoot, 'public', 'html-app-libraries');
const libraries = [
  ['chart', 'src/html-app-libraries/chart.js', 'JarvisChart'],
  ['d3', 'src/html-app-libraries/d3.js', 'JarvisD3'],
  ['katex', 'src/html-app-libraries/katex.js', 'JarvisKatex'],
  ['leaflet-offline', 'src/html-app-libraries/leaflet-offline.js', 'JarvisLeafletOffline'],
  ['mermaid', 'src/html-app-libraries/mermaid.js', 'JarvisMermaid'],
  ['three', 'src/html-app-libraries/three.js', 'JarvisThree'],
];

await rm(outputDirectory, { recursive: true, force: true });
for (const [fileName, entry, globalName] of libraries) {
  await build({
    configFile: false,
    root: webRoot,
    logLevel: 'error',
    build: {
      emptyOutDir: false,
      outDir: outputDirectory,
      assetsInlineLimit: 500_000,
      lib: {
        entry: join(webRoot, entry),
        name: globalName,
        formats: ['iife'],
        fileName: () => `${fileName}.js`,
        cssFileName: fileName,
      },
    },
  });
}
