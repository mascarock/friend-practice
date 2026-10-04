// Adapted from Vibefy's desktop:dmg build: fresh UI, then electron-builder.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const groundingFiles = ['src/lib/crew/ground.ts', 'src/lib/crew/ground.test.ts', 'src/lib/crew/prompts.ts'];
function groundingHashes() {
  return Object.fromEntries(groundingFiles.map((file) => [file, createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex')]));
}
function run(command, args, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
(async () => {
  const args = process.argv.slice(2);
  if (!args.length) throw new Error('Pass --dir or --mac dmg.');
  const grounding = groundingHashes();
  await run('npm', ['test']);
  // The shared checkout can have Next dev running while the DMG is built.
  // Never let production and development webpack caches share an output tree.
  await run('npm', ['run', 'build'], { LOCAL_COMPUTER_BUILD: '1' });
  const server = path.join(root, '.next-desktop/standalone');
  fs.cpSync(path.join(root, '.next-desktop/static'), path.join(server, '.next-desktop/static'), { recursive: true });
  fs.cpSync(path.join(root, 'public'), path.join(server, 'public'), { recursive: true });
  fs.writeFileSync(path.join(server, 'desktop-build.json'), JSON.stringify({ builtAt: new Date().toISOString(), grounding }, null, 2) + '\n');
  // No inherited credentials, .env files, or development caches in the app.
  for (const entry of fs.readdirSync(server)) {
    if (entry.startsWith('.env')) fs.rmSync(path.join(server, entry), { force: true });
  }
  fs.mkdirSync(path.join(root, 'build'), { recursive: true });
  await run('xcrun', ['swift', 'native/icon.swift', path.join(root, 'build/icon.png')]);
  await run(path.join(root, 'node_modules/.bin/electron-builder'), [...args, '--publish', 'never'], { CSC_IDENTITY_AUTO_DISCOVERY: 'false' });
  if (JSON.stringify(grounding) !== JSON.stringify(groundingHashes())) {
    throw new Error('Claude updated grounding during packaging. Run the build again to include the latest files.');
  }
  if (args.includes('dmg')) {
    const output = '/Users/nick/Desktop/Local-Computer.dmg';
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(path.join(root, 'dist/Local-Computer.dmg'), output);
    await run('hdiutil', ['verify', output]);
    console.log(`Ready: ${output}`);
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
