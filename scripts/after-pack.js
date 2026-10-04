const fs = require('node:fs');
const path = require('node:path');

// electron-builder filters node_modules in extraResources; the standalone
// Next runtime needs its traced dependencies exactly as Next emitted them.
exports.default = async function afterPack(context) {
  const destination = path.join(context.appOutDir, 'Local Computer.app/Contents/Resources/server');
  fs.cpSync(path.join(context.packager.projectDir, '.next-desktop/standalone'), destination, {
    recursive: true,
    filter: (source) => !path.basename(source).startsWith('.env') && !source.includes('/.next-desktop/cache/'),
  });
  if (!fs.existsSync(path.join(destination, 'node_modules/next/package.json'))) {
    throw new Error('Packaged Next runtime is incomplete.');
  }
};
