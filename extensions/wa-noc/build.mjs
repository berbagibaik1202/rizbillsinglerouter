import { build } from 'vite';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, 'dist');
await build({ configFile: false, root, build: { outDir, emptyOutDir: true, rollupOptions: { input: path.join(root, 'options.html') } } });
await build({ configFile: false, root, define: { 'process.env.NODE_ENV': '"production"' }, build: {
    outDir, emptyOutDir: false,
    lib: { entry: path.join(root, 'src/content.tsx'), name: 'RizkiTechNoc', formats: ['iife'], fileName: () => 'content.js' },
} });
await mkdir(outDir, { recursive: true });
for (const file of ['manifest.json', 'background.js']) await copyFile(path.join(root, file), path.join(outDir, file));
console.log(`Load unpacked: ${outDir}`);
