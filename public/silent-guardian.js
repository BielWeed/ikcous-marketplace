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

  // DONO NUNCA (issue #92): este arquivo é splash + fallback do loader —
  // ele NÃO decide recuperação de erro de chunk. É estático e sem hash na
  // URL (o catch-all do sw.ts o serve stale-while-revalidate), então seria
  // a peça mais VELHA do navegador decidindo sobre código mais novo. A
  // decisão vive em src/lib/recuperacao-chunk.ts, consumida pelo
  // GlobalErrorBoundary, pelos canais do main.tsx e pelo sentinela.

  // PONTO DE SINCRONIZAÇÃO DA BUILD — não é dono de nada (issue #92). O
  // token "1773003981700" é exigido e substituído em tempo de build pela
  // versão entregue (scripts/identityBuildConfig.ts); apagá-lo quebra o
  // sistema de identidade hermética (testes identity-build-*). O runtime
  // do app NÃO lê esta global para decidir: a versão que alimenta a
  // recuperação de chunk vem do define compile-time do Vite.
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
