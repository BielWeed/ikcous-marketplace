(function () {
  // Splash check
  if (sessionStorage.getItem('splash_shown')) {
    document.documentElement.classList.add('splash-shown');
  }

  // Ghost Purge Logic
  const RESET_KEY = 'pwa_reset_v11.5';
  const isAlreadyReset = localStorage.getItem(RESET_KEY);

  console.log('[SilentGuardian] Ghost Purge v11.5 check...');

  if (!isAlreadyReset) {
    console.log('[SilentGuardian] Initiating GHOST PURGE v11.5...');

    // 1. Unregister ALL
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function (registrations) {
        for (let registration of registrations) registration.unregister();
      });
    }

    // 2. Erase Caches
    if ('caches' in globalThis) {
      caches.keys().then(function (names) {
        for (let name of names) caches.delete(name);
      });
    }

    // 3. Complete Storage Purge (Safe)
    // No longer clearing localStorage to preserve auth session
    sessionStorage.clear();

    // 4. Mark v11.2_final
    localStorage.setItem(RESET_KEY, 'true');

    // 5. Force clean reload with dummy paramilitary to avoid cached HTML
    globalThis.location.replace(globalThis.location.origin + globalThis.location.pathname + '?gp_v11_4=' + Date.now());
  }

  // NUCLEAR FALLBACK: If React fails to remove the loader, do it ourselves after 20s
  setTimeout(function () {
    const loader = document.getElementById('silent-guardian-loader');
    if (loader && loader.style.opacity !== '0') {
      console.warn('[SilentGuardian] React failed to unblock UI. Nuclear fallback triggered.');
      loader.style.opacity = '0';
      setTimeout(function () { loader.remove(); }, 500);
    }
  }, 20000);

  // Initialize global app version constant
  globalThis.__APP_VERSION__ = "1773003981700"; // Build sync point

  // Progress Bar Logic
  globalThis.addEventListener('DOMContentLoaded', function() {
    let fill = document.getElementById('guardian-progress-fill');
    let pct = document.getElementById('guardian-progress-pct');
    let progress = 0;

    globalThis.guardianProgress = 0;

    setTimeout(function () {
      let interval = setInterval(function () {
        let step = Math.random() * 8 + 2;
        progress += step;
        if (progress > 85) progress = 85;

        globalThis.guardianProgress = progress;

        if (fill) fill.style.width = progress + '%';
        if (pct) pct.textContent = Math.round(progress) + '%';

        if (progress >= 85) clearInterval(interval);
      }, 150);
      globalThis.guardianProgressInterval = interval;
    }, 1200); // Wait for the text-fade-in animation to finish
  });
})();
