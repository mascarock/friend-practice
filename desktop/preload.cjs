// Vibefy's isolated preload pattern, with no privileged renderer commands.
window.addEventListener('DOMContentLoaded', () => {
  document.documentElement.classList.add('desktop-shell');
  const strip = document.createElement('div');
  strip.className = 'desktop-drag-strip';
  strip.setAttribute('aria-hidden', 'true');
  document.body.appendChild(strip);
});
