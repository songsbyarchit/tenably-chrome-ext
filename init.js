// init.js — theme toggle + tab switching
// Must be an external file; inline <script> blocks are blocked by MV3 CSP.

(function () {
  // ── Apply saved theme on load ──────────────────────────────────────────
  const saved = localStorage.getItem('tenably-theme') || 'light';
  document.documentElement.setAttribute('data-theme', saved);

  const iconSun  = document.getElementById('icon-sun');
  const iconMoon = document.getElementById('icon-moon');
  if (saved === 'dark') {
    iconSun.style.display  = 'none';
    iconMoon.style.display = '';
  }

  // ── Theme toggle button ────────────────────────────────────────────────
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('tenably-theme', next);
    iconSun.style.display  = next === 'dark' ? 'none' : '';
    iconMoon.style.display = next === 'dark' ? '' : 'none';
  });

  // ── Tab switching ──────────────────────────────────────────────────────
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      if (typeof switchTab === 'function') switchTab(btn.dataset.tab);
    });
  });
})();
