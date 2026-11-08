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

  // APP QUE NÃO ABRE: se o arquivo principal do app (o <script type="module">
  // do index.html) não baixa, ou nem chega a ligar o app, os tratadores de
  // erro do app não existem (moram dentro desse mesmo arquivo) e sobrava uma
  // página branca com a rodinha girando para sempre. Aqui, na única peça que
  // já está na página, a rodinha vira uma frase e um botão. Quem decide é o
  // pedido da pessoa (o botão); nenhum recarregamento acontece sozinho.
  // "App ligado" = o main.tsx já definiu removeSilentGuardianLoader; se #root
  // já tem algo além da rodinha, o React (ou a tela de manutenção da ficha)
  // já pintou, e este aviso não pisa nisso. O React troca o aviso sozinho
  // quando o app finalmente sobe (createRoot limpa o #root).
  const mostrarFalhaDeArranque = () => {
    if (typeof globalThis.removeSilentGuardianLoader === "function") return;
    const root = document.getElementById("root");
    if (!root) return;
    const soRodinha = Array.from(root.children).every((el) =>
      el.classList.contains("loading-spinner"),
    );
    if (!soRodinha) return;

    // O splash cobre a tela inteira: sem tirá-lo, o aviso ficaria escondido.
    if (globalThis.guardianProgressInterval) {
      clearInterval(globalThis.guardianProgressInterval);
    }
    document.getElementById("silent-guardian-loader")?.remove();

    const aviso = document.createElement("div");
    aviso.setAttribute("role", "alert");
    aviso.style.cssText =
      "position:fixed;inset:0;display:flex;flex-direction:column;" +
      "align-items:center;justify-content:center;gap:20px;padding:24px;" +
      "text-align:center;background:#fafafa;color:#18181b;" +
      "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif";

    const frase = document.createElement("p");
    frase.style.cssText =
      "margin:0;max-width:320px;font-size:16px;line-height:1.5";
    frase.textContent =
      "Não conseguimos abrir o app. Confira a internet e tente de novo.";

    const botao = document.createElement("button");
    botao.type = "button";
    botao.style.cssText =
      "padding:14px 28px;border:0;border-radius:14px;background:#18181b;" +
      "color:#fafafa;font-size:15px;font-weight:700;cursor:pointer";
    botao.textContent = "Tentar de novo";
    botao.addEventListener("click", () => {
      globalThis.location.reload();
    });

    aviso.append(frase, botao);
    root.replaceChildren(aviso);
  };

  // O arquivo principal falhou de verdade (rede caiu, 404, bloqueio): o
  // 'error' do <script> não borbulha, então se escuta na captura do documento.
  document.addEventListener(
    "error",
    (evento) => {
      const alvo = evento.target;
      if (
        alvo instanceof HTMLScriptElement &&
        alvo.getAttribute("type") === "module"
      ) {
        mostrarFalhaDeArranque();
      }
    },
    true,
  );

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
    // Aos 20 s, se o app nem ligou, a rodinha vira o aviso (ver acima).
    mostrarFalhaDeArranque();
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
