// The shipped runtime serves only the authenticated native web view.
const http = require('node:http');
const token = process.env.LOCAL_COMPUTER_TOKEN;
if (!token) throw new Error('Local Computer must be launched from its app.');
const emit = http.Server.prototype.emit;
http.Server.prototype.emit = function (event, req, res, ...rest) {
  if (event === 'request') {
    const cookie = (req.headers.cookie || '').split(';').map(value => value.trim());
    if (req.headers['x-local-computer'] !== token && !cookie.includes(`local-computer=${token}`)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Open Local Computer to use these local bots.');
      return true;
    }
    res.setHeader('X-Local-Computer', token);
    res.setHeader('Set-Cookie', `local-computer=${token}; HttpOnly; SameSite=Strict; Path=/`);
  }
  return emit.call(this, event, req, res, ...rest);
};
const localFetch = globalThis.fetch;
globalThis.fetch = function (input, options = {}) {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.origin !== 'http://127.0.0.1:11434') throw new Error('Only local Ollama is allowed.');
  return localFetch(input, { ...options, redirect: 'error' });
};
// Do not leave a helper behind if the native shell crashes or is force-quit.
setInterval(() => {
  try { process.kill(Number(process.env.LOCAL_COMPUTER_PARENT), 0); }
  catch { process.exit(0); }
}, 2000).unref();
