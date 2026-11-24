import { type PointerEvent as EventoDeToque, useCallback, useRef } from "react";

// Arrasto da alça de uma folha que sobe de baixo (a "abinha" com a barrinha
// cinza). Compartilhado por todas as folhas inferiores — um gesto só, igual em
// todas. Medido no Chromium (toque real, 24/11/2026), o tremor tinha causa
// certa: ao SOLTAR além do limite o código antigo zerava o transform ANTES de
// fechar, então a folha PULAVA de volta ao lugar de repouso (150 px acima de
// onde o dedo a deixou) e só então descia. Aqui a folha segue o dedo, e soltar
// além do limite a faz DESCER da posição em que o dedo a largou — só depois o
// `aoFechar` roda. Soltar antes do limite devolve suave ao lugar.
const LIMIAR_PX = 64;
const MS_DA_SAIDA = 220;
const MS_DA_VOLTA = 180;
// O deslocamento vai na propriedade individual `translate`, NUNCA em
// `transform`: o `-translate-x-1/2` do Tailwind v3 (folha centrada com
// `left-1/2`, como o Dialog de "Ações do pedido") mora em `transform`, e
// escrever `transform` o SUBSTITUI — a folha pulava de lado no arrasto. As duas
// propriedades se compõem (translate, depois transform), então o X do elemento
// fica intacto e só o Y muda. Chrome 104+, Safari 14.1+, Firefox 72+.
const LUGAR = "0 0";
const FORA = "0 100%";
const emPx = (dy: number) => `0 ${dy}px`;
const suportaTranslate = () =>
  typeof CSS === "undefined" ||
  !CSS.supports ||
  CSS.supports("translate", "0 0");

type Gesto = { y: number; movimentou: boolean };

// jsdom e navegadores sem a API: devolve null e o efeito é imediato.
function deslizar(
  el: HTMLElement,
  quadros: Keyframe[],
  ms: number,
  segurar: boolean,
) {
  if (typeof el.animate !== "function") return null;
  return el.animate(quadros, {
    duration: ms,
    easing: "ease-out",
    fill: segurar ? "forwards" : "none",
  });
}

export function useArrastarParaFechar(aoFechar: () => void) {
  const gesto = useRef<Gesto>({ y: 0, movimentou: false });
  const fechar = useRef(aoFechar);
  fechar.current = aoFechar;

  const aoApertar = (e: EventoDeToque<HTMLElement>) => {
    // Só o dedo que apertou a alça: um segundo dedo não inicia outro gesto.
    if (e.button > 0 || e.isPrimary === false) return;
    if (!suportaTranslate()) return; // sem a propriedade: só o toque fecha
    const folha = e.currentTarget.closest<HTMLElement>('[role="dialog"]');
    if (!folha || folha.dataset.state === "closed") return;
    // Gaveta lateral do computador (altura toda, colada no topo): puxar para
    // baixo não tem sentido — quem fecha ali é o X.
    if (getComputedStyle(folha).top === "0px") return;
    const g = (gesto.current = { y: e.clientY, movimentou: false });
    const id = e.pointerId;
    const veu = folha.previousElementSibling;
    // A entrada (animate-in) ainda rodando ganharia do deslocamento inline.
    for (const a of folha.getAnimations?.() ?? []) a.finish();
    // Camada própria só durante o gesto; sem transição para não virar atraso.
    folha.style.transitionProperty = "none";
    folha.style.willChange = "translate";
    let dy = 0;
    let quadro = 0;
    const aoMover = (ev: PointerEvent) => {
      if (id !== undefined && ev.pointerId !== id) return;
      dy = Math.max(0, ev.clientY - g.y);
      if (dy > 8) g.movimentou = true;
      // Uma escrita por quadro, não uma por evento de toque.
      quadro ||= requestAnimationFrame(() => {
        quadro = 0;
        folha.style.translate = emPx(dy);
      });
    };
    const limpar = () => {
      folha.style.transitionProperty = "";
      folha.style.translate = "";
      folha.style.willChange = "";
    };
    // Volta ao lugar a partir de `de`. A transição CSS da folha fica desligada
    // até a animação acabar: ligada, ela disputava o mesmo deslocamento.
    const voltar = (de: string) => {
      folha.style.translate = "";
      const volta = deslizar(
        folha,
        [{ translate: de }, { translate: LUGAR }],
        MS_DA_VOLTA,
        false,
      );
      if (volta) volta.onfinish = volta.oncancel = limpar;
      else limpar();
    };
    const aoSoltar = (ev: PointerEvent) => {
      if (id !== undefined && ev.pointerId !== id) return;
      window.removeEventListener("pointermove", aoMover);
      window.removeEventListener("pointerup", aoSoltar);
      window.removeEventListener("pointercancel", aoSoltar);
      cancelAnimationFrame(quadro);
      dy = Math.max(0, ev.clientY - g.y);
      const aqui = emPx(dy);
      if (ev.type === "pointercancel" || dy <= LIMIAR_PX) return voltar(aqui);
      // Desce da posição em que o dedo largou (não do repouso), e o véu some
      // junto; só no fim a folha "fecha" de verdade.
      folha.style.translate = aqui;
      const descida = deslizar(
        folha,
        [{ translate: aqui }, { translate: FORA }],
        MS_DA_SAIDA,
        true,
      );
      const sumir =
        veu instanceof HTMLElement && veu.hasAttribute("data-state")
          ? deslizar(veu, [{ opacity: 1 }, { opacity: 0 }], MS_DA_SAIDA, true)
          : null;
      let fechou = false;
      const concluir = () => {
        if (fechou) return;
        fechou = true;
        // A folha (e o véu) já saíram da tela: a animação de saída do Radix
        // só seguraria a página travada por mais um instante.
        folha.style.animationName = "none";
        if (veu instanceof HTMLElement) veu.style.animationName = "none";
        fechar.current();
        // Quem abriu pode recusar fechar (confirmação de descarte, envio em
        // andamento): a folha não pode ficar presa fora da tela.
        window.setTimeout(() => {
          if (!folha.isConnected || folha.dataset.state === "closed") return;
          descida?.cancel();
          sumir?.cancel();
          folha.style.animationName = "";
          if (veu instanceof HTMLElement) veu.style.animationName = "";
          voltar(FORA);
        }, 250);
      };
      if (!descida) return concluir();
      descida.onfinish = concluir;
      // Aba escondida não gera quadros: o fecho não pode depender da animação.
      window.setTimeout(concluir, MS_DA_SAIDA + 150);
    };
    window.addEventListener("pointermove", aoMover);
    window.addEventListener("pointerup", aoSoltar);
    window.addEventListener("pointercancel", aoSoltar);
  };

  // Estáveis (useCallback): vão em dependência de efeito sem re-disparar.
  const engoliuClique = useCallback(() => {
    const foi = gesto.current.movimentou;
    gesto.current.movimentou = false;
    return foi;
  }, []);
  const zerarGuarda = useCallback(() => {
    gesto.current.movimentou = false;
  }, []);

  // `engoliuClique`: o clique sintético que o navegador solta depois de um
  // arrasto de verdade é engolido (true, uma vez) — senão um arrasto curto
  // fecharia a folha.
  return { aoApertar, engoliuClique, zerarGuarda };
}
