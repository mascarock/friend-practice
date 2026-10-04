import { _electron as electron } from 'playwright-core';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';

// Off-screen PNG capture only. No recording, media player, or audio output.
const output = '/Users/nick/friend-practice-video';
await fs.mkdir(output, { recursive: true });
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'local-computer-chat-'));
const executablePath = process.env.LOCAL_COMPUTER_APP || path.resolve('dist/mac-arm64/Local Computer.app/Contents/MacOS/Local Computer');
const manifest = JSON.parse(await fs.readFile(path.resolve(path.dirname(executablePath), '../Resources/server/desktop-build.json'), 'utf8'));
for (const [file, hash] of Object.entries(manifest.grounding)) {
  assert.equal(createHash('sha256').update(await fs.readFile(file)).digest('hex'), hash, `Packaged grounding is stale: ${file}`);
}
const app = await electron.launch({ executablePath, env: { ...process.env, LOCAL_COMPUTER_DEMO_PROFILE: profile, LOCAL_COMPUTER_OFFSCREEN: '1' } });
const notes = { verifiedAt: new Date().toISOString(), executablePath, build: manifest };
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.waitForURL('http://127.0.0.1:43130/computer', { timeout: 30000 });
  await page.getByRole('button', { name: 'Chat with Ledger', exact: true }).waitFor();
  await page.getByRole('textbox', { name: 'Message Ledger', exact: true }).waitFor();
  await page.waitForFunction(() => localStorage.getItem('local-computer:crew:v1'));
  assert.deepEqual(await page.locator('.crew-bot-name').evaluateAll((rows) => rows.map((row) => row.firstChild.textContent)), ['Ledger', 'Clerk', 'Watcher', 'Remainder', 'Note']);
  assert.deepEqual(await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    return { muted: window.webContents.isAudioMuted(), offscreen: window.webContents.isOffscreen(), visible: window.isVisible() };
  }), { muted: true, offscreen: true, visible: false });
  assert.notEqual(await page.locator('.crew-sidebar').evaluate((element) => getComputedStyle(element).backdropFilter), 'none');
  assert.equal(await page.getByRole('button', { name: /^Run / }).count(), 0);
  const readState = () => page.evaluate(() => JSON.parse(localStorage.getItem('local-computer:crew:v1')));
  const approvedBefore = (await readState()).budget;
  async function select(bot) {
    await page.getByRole('button', { name: `Chat with ${bot}`, exact: true }).click();
  }
  async function send(bot, message) {
    await select(bot);
    const before = await page.locator('.crew-message-assistant').count();
    await page.getByRole('textbox', { name: `Message ${bot}`, exact: true }).fill(message);
    await page.getByRole('button', { name: `Send to ${bot}`, exact: true }).click();
    await page.waitForFunction((count) => document.querySelectorAll('.crew-message-assistant').length === count + 1 && document.querySelector('.crew-thread').getAttribute('aria-busy') === 'false', before, { timeout: 35000 });
  }
  async function capture(file) {
    await page.screenshot({ path: path.join(output, file), animations: 'disabled' });
  }
  // The single prior demo spend is entered through Clerk, never historical sample spends.
  await send('Clerk', 'log 4700 on Q4 trade fair for the sample stand and travel');
  assert.equal((await readState()).spends.length, 1);
  await send('Ledger', "what's approved for Meta Ads?");
  assert.equal(await page.locator('.crew-message-user').innerText().then((s) => s.includes("what's approved for Meta Ads?")), true);
  assert.match(await page.locator('.crew-answer').innerText(), /Meta Ads has 3,200.00 approved/);
  assert.match(await page.locator('.crew-source').innerText(), /SAMPLE DATA/);
  await capture('01-sidebar.png');
  await capture('02-ledger.png');

  await send('Watcher', 'anything over?');
  assert.equal(await page.locator('.crew-answer .crew-result-message').innerText(), 'Q4 trade fair is over budget by 200.00.');
  await capture('03-watcher-answer.png');

  await send('Remainder', 'how much is left?');
  assert.deepEqual(await page.locator('.crew-totals dd').allTextContents(), ['16,700.00', '4,700.00', '12,000.00']);
  await capture('04-remainder.png');

  const response = page.waitForResponse((response) => response.url().endsWith('/api/crew'), { timeout: 35000 });
  await send('Note', 'one sentence for Paola');
  const result = await (await response).json();
  assert.ok(['ok', 'withheld', 'unavailable'].includes(result.status));
  assert.deepEqual(result.toolResult.lines.map((line) => line.item), ['Q4 trade fair']);
  assert.deepEqual([result.toolResult.approved, result.toolResult.spent, result.toolResult.remaining], [16700, 4700, 12000]);
  assert.equal(await page.locator('.crew-note').innerText(), result.text);
  assert.match(await page.locator('.crew-answer').innerText(), /Q4 trade fair is over budget by 200.00/);
  notes.note = result;
  await capture('05-note.png');

  // Only after all requested pre-spend screenshots exist, type the Clerk example.
  await select('Clerk');
  await page.getByRole('textbox', { name: 'Message Clerk', exact: true }).fill('log 200 on Meta Ads for the sample stand');
  await capture('06-clerk.png');
  assert.equal((await readState()).spends.length, 1, 'Clerk example must remain unsubmitted in the screenshots');

  // Verify retention, clarification, and the approved invariant after captures.
  await page.reload();
  await select('Ledger');
  assert.equal(await page.locator('.crew-message').count(), 2);
  await send('Ledger', "what's approved for an unknown item?");
  assert.equal(await page.locator('.crew-message').count(), 4);
  assert.match(await page.locator('.crew-answer').last().innerText(), /Which item or category/);
  await select('Remainder');
  assert.deepEqual(await page.locator('.crew-totals dd').allTextContents(), ['16,700.00', '4,700.00', '12,000.00']);
  await send('Clerk', 'log 200 on Meta Ads for the sample stand');
  const saved = await readState();
  assert.equal(saved.spends.length, 2);
  assert.deepEqual(saved.budget, approvedBefore, 'Every approved row must stay unchanged');
  await select('Remainder');
  assert.match(await page.locator('.crew-snapshot').innerText(), /spending has changed/);
  await send('Remainder', 'how much is left?');
  assert.deepEqual(await page.locator('.crew-answer').last().locator('.crew-totals dd').allTextContents(), ['16,700.00', '4,900.00', '11,800.00']);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 700));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Minimum Mac window must not overflow horizontally');
  assert.equal(await page.locator('.crew-composer').evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight), true, 'Composer remains visible');
  assert.equal((await fetch('http://127.0.0.1:43130/computer')).status, 403);
  assert.equal(await page.evaluate(async () => { try { await fetch('https://example.com'); return true; } catch { return false; } }), false);
  assert.deepEqual(errors, []);
  notes.checks = ['Off-screen hidden window, audio muted, no recording', 'Separate persistent chat threads', 'One prior spend only in screenshots', 'Approved total remains 16700 after Clerk', 'Strict Watcher list and correct remainder', 'Real local Gemma response grounded', 'Clarification for unmapped messages', 'Historical replies retained and marked after a spend', 'Minimum window layout fits', 'Remote requests blocked', 'No renderer exceptions'];
  await fs.writeFile(path.join(output, 'verification.json'), JSON.stringify(notes, null, 2) + '\n');
  console.log(JSON.stringify(notes, null, 2));
} finally {
  await app.close();
  await fs.rm(profile, { recursive: true, force: true });
}
console.log(`Silent chat screenshots: ${output}`);
