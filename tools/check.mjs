import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root = resolve('extension');
const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.minimum_chrome_version, '116');
assert.deepEqual(manifest.permissions.toSorted(), ['activeTab', 'offscreen', 'scripting', 'storage', 'tabCapture', 'tabs']);
assert.ok(!manifest.host_permissions);
for (const path of [manifest.background.service_worker, manifest.action.default_popup, 'offscreen.html', 'fullscreen-observer.js']) {
  assert.ok(existsSync(resolve(root, path)), `Missing ${path}`);
}
let count = 0;
function check(directory) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) check(path);
    else if (item.name.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
      const code = readFileSync(path, 'utf8');
      for (const [, dependency] of code.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        assert.ok(existsSync(resolve(directory, dependency)), `Missing import ${dependency} in ${item.name}`);
      }
      count++;
    }
  }
}
check(root);
console.log(`Manifest, minimal permissions, entry files, imports and syntax: OK (${count} JS files)`);
