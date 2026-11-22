import {readFileSync} from 'node:fs';
import {defineConfig} from 'vite';
import tailwindcss from '@tailwindcss/vite';
import {prepaint} from '@doshi-experiments/design-system/vite';

const fonts = new URL('./node_modules/@doshi-experiments/design-system/dist/fonts/', import.meta.url);

// One page. prepaint() inlines the shared appearance script right after <meta charset>,
// before any stylesheet, so the saved Light or Dark is on the root at first paint. Vite
// bundles the Host Grotesk files from the release; their OFL licence ships beside them.
export default defineConfig({
  plugins: [tailwindcss(), prepaint(), {
    name: 'font-licence',
    generateBundle() {
      for (const name of ['host-grotesk-OFL.txt', 'host-grotesk-source.txt']) this.emitFile({type: 'asset', fileName: `fonts/${name}`, source: readFileSync(new URL(name, fonts))});
    },
  }],
});
