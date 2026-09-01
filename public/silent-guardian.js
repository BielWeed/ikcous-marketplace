(() => {
  // Splash check
  if (sessionStorage.getItem("splash_shown")) {
    document.documentElement.classList.add("splash-shown");
  }

  // GHOST PURGE APOSENTADO (laudo ofensiva 3108, achado N5).
  //
  // O que vivia aqui ("Ghost Purge v17.0"): na primeira visita, desregistrar
  // TODOS os service workers, apagar TODOS os caches e forçar um reload com
  // um parâmetro de purge na URL. Era andaime de era de dev contra cache
  // estragado de versões antigas; o efeito medido em 31/08: TODO visitante
  // novo começava a sessão com a PWA desligada à mão (SW desregistrado +
  // precache apagado + reload forçado) e offline o app nem tinha com o que
  // contar.
  //
  // O purge que roda uma vez por navegador não precisa mais de chave de
  // localStorage: quem precisava dele já o executou (a chave está gravada);
  // quem nasce hoje nasce com o SW novo e o ramo de navegação cache-first
  // (sw.ts) — apagar cache de terceiros na porta de entrada ficou proibido.

  // NUCLEAR FALLBACK: If React fails to remove the loader, do it ourselves after 20s
  setTimeout(() => {
    const loader = document.getElementById("silent-guardian-loader");
    if (loader && loader.style.opacity !== "0") {
      console.warn(
        "[SilentGuardian] React failed to unblock UI. Nuclear fallback triggered.",
      );
      loader.style.opacity = "0";
      setTimeout(() => {
        loader.remove();
      }, 500);
    }
  }, 20000);

  // Initialize global app version constant
  globalThis.__APP_VERSION__ = "1773003981700"; // Build sync point

  // Progress Bar Logic
  globalThis.addEventListener("DOMContentLoaded", () => {
    const fill = document.getElementById("guardian-progress-fill");
    const pct = document.getElementById("guardian-progress-pct");
    let progress = 0;

    globalThis.guardianProgress = 0;

    setTimeout(() => {
      const interval = setInterval(() => {
        const step = Math.random() * 8 + 2;
        progress += step;
        if (progress > 85) progress = 85;

        globalThis.guardianProgress = progress;

        if (fill) fill.style.width = `${progress}%`;
        if (pct) pct.textContent = `${Math.round(progress)}%`;

        if (progress >= 85) clearInterval(interval);
      }, 80);
      globalThis.guardianProgressInterval = interval;
    }, 100); // Start animating almost immediately for better responsiveness
  });
})();
