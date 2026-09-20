// Copies dist/ to dist-test/ with "debugger" as a required permission, for the headless
// suite: an optional permission needs a prompt, and nobody is there to accept it.
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('dist');
const out = path.resolve('dist-test');
if (!fs.existsSync(path.join(src, 'manifest.json'))) throw new Error('dist/ missing; run npm run build');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true });
const manifestPath = path.join(out, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.permissions = [...new Set([...(manifest.permissions || []), ...(manifest.optional_permissions || [])])];
delete manifest.optional_permissions;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log('dist-test/ ready (debugger permission granted at install)');
