import * as esbuild from 'esbuild'

await esbuild.build({
  entryPoints: ['./src/index.js'],
  outfile: './dist/bluesky.js',
  bundle: true,
  globalName: 'bluesky',
  minify: true,
  sourcemap: true,
  target: ['chrome58', 'firefox57', 'safari11', 'edge18'],
})
