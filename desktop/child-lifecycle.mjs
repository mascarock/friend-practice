function wait(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

/** Stop a child reliably even though ChildProcess.killed only means a signal was sent. */
export async function terminateChild(child, { graceMs = 2_000 } = {}) {
  if (!child || child.exitCode !== null) return;
  let exited = false;
  let resolveExit;
  const exitedPromise = new Promise((resolve) => { resolveExit = resolve; });
  const onExit = () => { exited = true; resolveExit(); };
  child.once('exit', onExit);
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
  await Promise.race([exitedPromise, wait(graceMs)]);
  if (!exited && child.exitCode === null) {
    try { child.kill('SIGKILL'); } catch { /* already gone */ }
  }
  child.off?.('exit', onExit);
}
