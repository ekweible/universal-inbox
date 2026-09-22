// Trunk's custom Tailwind hook bypasses its asset hashing. Give the generated
// stylesheets content-based names so an existing PWA cannot mix old CSS with
// a new WASM bundle after deployment.
const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync, renameSync } = require('node:fs');
const { join } = require('node:path');

const directory = process.argv[2];
if (!directory) throw new Error('Expected Trunk staging directory');
const htmlPath = join(directory, 'index.html');
let html = readFileSync(htmlPath, 'utf8');
for (const name of ['universal-inbox.min.css', 'flatpickr.min.css']) {
  const path = join(directory, 'css', name);
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);
  const versioned = name.replace('.css', `-${digest}.css`);
  if (!html.includes(`/css/${name}`)) throw new Error(`Missing stylesheet reference: ${name}`);
  renameSync(path, join(directory, 'css', versioned));
  html = html.replaceAll(`/css/${name}`, `/css/${versioned}`);
}
writeFileSync(htmlPath, html);
