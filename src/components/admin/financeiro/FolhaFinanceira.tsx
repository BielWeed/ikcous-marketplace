import { Pencil, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as EventoDePonteiro,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAlturaDoTeclado } from "@/hooks/useAlturaDoTeclado";
import { useTelaLarga } from "@/hooks/useFinanceiro";
import { cn } from "@/lib/utils";
import { ContextoDoDescarte, PerguntaDeDescarte } from "./descarte";

// Arrasto da alça: passou de 1/4 da altura OU desceu rápido (px/ms) → fecha.
const FRACAO_PARA_FECHAR = 0.25;
const VELOCIDADE_PARA_FECHAR = 0.5;
const MS_DA_SAIDA = 160;

type Amostra = { readonly t: number; readonly y: number };
type Gesto = {
  readonly id: number;
  readonly y0: number;
  readonly altura: number;
  ant: Amostra;
  ult: Amostra;
};

function reduzMovimento(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * A folha de todo formulário do Financeiro: sobe de baixo no celular (o
 * polegar alcança; NN/g, bottom sheet) e abre pela direita no computador.
 * Corpo rola sozinho; o rodapé com a ação principal fica sempre à vista,
 * acima da área segura do aparelho.
 *
 * Quem fecha é SEMPRE `aoFechar` (X, toque no véu, Esc, a alça arrastada para
 * baixo e o Voltar do celular, que a view liga por `onSetBackOverride`) — a
 * folha não guarda estado próprio, só o deslocamento do dedo durante o
 * arrasto. O X é o ÚNICO botão de fechar: o rodapé leva só a ação principal.
 * Com algo escrito, a view transforma esse pedido em pergunta ("Descartar o
 * que você escreveu?"), que a folha desenha por dentro (`ContextoDoDescarte`).
 */
export function FolhaFinanceira({
  titulo,
  descricao,
  aoFechar,
  children,
  rodape,
  icone: Icone = Pencil,
  fecharBloqueado = false,
}: {
  readonly titulo: string;
  readonly descricao?: ReactNode;
  readonly aoFechar: () => void;
  readonly children: ReactNode;
  readonly rodape?: ReactNode;
  readonly icone?: LucideIcon;
  /** Mantida por compatibilidade: o casco novo usa selo neutro (cor só com significado). */
  readonly matiz?: string;
  /** Enquanto grava: o X e o arrasto ficam parados (Esc e véu seguem `aoFechar`). */
  readonly fecharBloqueado?: boolean;
}) {
  const larga = useTelaLarga();
  const descarte = useContext(ContextoDoDescarte);
  const { altura: teclado, alturaVisivel } = useAlturaDoTeclado();
  const [arrasto, setArrasto] = useState(0);
  const [segurando, setSegurando] = useState(false);
  const gesto = useRef<Gesto | null>(null);
  const timerDaSaida = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timerDaSaida.current), []);
  // O teclado do celular se sobrepõe à página: a folha sobe acima dele e,
  // ao focar um campo, ele é trazido à vista dentro do corpo que rola.
  useEffect(() => {
    if (larga) return;
    let timer: number | undefined;
    const aoFocar = (evento: FocusEvent) => {
      const alvo = evento.target;
      if (!(alvo instanceof HTMLElement)) return;
      if (alvo.tagName !== "INPUT" && alvo.tagName !== "TEXTAREA") return;
      if (!alvo.closest("[data-folha-financeira]")) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(
        // `?.`: navegador sem a função (e o jsdom dos testes) não quebra.
        () => alvo.scrollIntoView?.({ block: "nearest" }),
        150,
      );
    };
    document.addEventListener("focusin", aoFocar);
    return () => {
      document.removeEventListener("focusin", aoFocar);
      window.clearTimeout(timer);
    };
  }, [larga]);
  // O teclado leva um tempo para abrir: refaz a rolagem quando a altura muda
  // com um campo da folha em foco (o de 150ms acima pode chegar cedo demais).
  useEffect(() => {
    if (larga || teclado === 0) return;
    const ativo = document.activeElement;
    if (!(ativo instanceof HTMLElement)) return;
    if (ativo.tagName !== "INPUT" && ativo.tagName !== "TEXTAREA") return;
    if (!ativo.closest("[data-folha-financeira]")) return;
    ativo.scrollIntoView?.({ block: "nearest" });
  }, [larga, teclado]);
  const comTeclado = !larga && teclado > 0;
  const podeArrastar = !larga && !fecharBloqueado && !descarte.perguntando;

  function aoApertar(evento: EventoDePonteiro<HTMLDivElement>) {
    if (evento.button > 0) return;
    const alvo = evento.target;
    // O X (e qualquer controle) clica normal: capturar o ponteiro o engoliria.
    if (alvo instanceof Element && alvo.closest("button, a, input, textarea")) {
      return;
    }
    const folha = evento.currentTarget.closest<HTMLElement>(
      "[data-folha-financeira]",
    );
    const amostra = { t: performance.now(), y: evento.clientY };
    gesto.current = {
      id: evento.pointerId,
      y0: evento.clientY,
      altura: folha?.offsetHeight || window.innerHeight,
      ant: amostra,
      ult: amostra,
    };
    evento.currentTarget.setPointerCapture?.(evento.pointerId);
    setSegurando(true);
  }

  function aoMover(evento: EventoDePonteiro<HTMLDivElement>) {
    const g = gesto.current;
    if (!g || evento.pointerId !== g.id) return;
    g.ant = g.ult;
    g.ult = { t: performance.now(), y: evento.clientY };
    setArrasto(Math.max(0, evento.clientY - g.y0));
  }

  function aoSoltar(evento: EventoDePonteiro<HTMLDivElement>) {
    const g = gesto.current;
    if (!g || evento.pointerId !== g.id) return;
    gesto.current = null;
    setSegurando(false);
    const dy = Math.max(0, evento.clientY - g.y0);
    // Velocidade do último trecho do movimento (o que o dedo fazia ao soltar).
    const dt = g.ult.t - g.ant.t;
    const velocidade = dt > 0 ? (g.ult.y - g.ant.y) / dt : 0;
    const fecha =
      dy > 0 &&
      (dy > g.altura * FRACAO_PARA_FECHAR ||
        velocidade > VELOCIDADE_PARA_FECHAR);
    if (!fecha) {
      setArrasto(0);
      return;
    }
    // Com algo escrito o arrasto vira pergunta: a folha volta ao lugar em vez
    // de descer inteira e reaparecer por baixo da pergunta.
    if (reduzMovimento() || descarte.sujo) {
      aoFechar();
      setArrasto(0);
      return;
    }
    setArrasto(g.altura);
    timerDaSaida.current = window.setTimeout(() => {
      aoFechar();
      setArrasto(0);
    }, MS_DA_SAIDA);
  }

  function aoCancelarArrasto() {
    gesto.current = null;
    setSegurando(false);
    setArrasto(0);
  }

  const estilo: CSSProperties = {};
  if (comTeclado) {
    estilo.bottom = teclado;
    estilo.maxHeight = `calc(${alturaVisivel}px - 1rem)`;
  }
  if (!larga) {
    if (arrasto > 0) estilo.transform = `translateY(${arrasto}px)`;
    estilo.transitionDuration = segurando || reduzMovimento() ? "0ms" : "150ms";
  }

  return (
    <Sheet
      open
      onOpenChange={(aberta) => {
        if (!aberta) aoFechar();
      }}
    >
      <SheetContent
        side={larga ? "right" : "bottom"}
        showCloseButton={false}
        // O véu do painel NÃO pode ser `bg-black/50`: nos temas Claro e
        // Confortável a regra gerada troca essa classe pelo fundo opaco do
        // painel e o app por trás some (cinza chapado). rgb() escapa da troca.
        overlayClassName="bg-[rgb(0_0_0/0.5)]"
        data-folha-financeira=""
        style={Object.keys(estilo).length > 0 ? estilo : undefined}
        className={cn(
          "gap-0 border-border bg-background p-0 text-foreground",
          larga ? "w-full sm:max-w-md" : "max-h-[84dvh] rounded-t-[28px]",
        )}
      >
        <div
          data-folha-arraste=""
          onPointerDown={podeArrastar ? aoApertar : undefined}
          onPointerMove={podeArrastar ? aoMover : undefined}
          onPointerUp={podeArrastar ? aoSoltar : undefined}
          onPointerCancel={podeArrastar ? aoCancelarArrasto : undefined}
          inert={descarte.perguntando}
          className={cn("shrink-0", podeArrastar && "touch-none")}
        >
          {larga ? null : (
            <div
              aria-hidden="true"
              className="flex h-11 items-center justify-center"
            >
              <span className="h-[5px] w-14 rounded-full bg-muted-foreground/40" />
            </div>
          )}
          <SheetHeader
            className={cn("gap-0 px-5 pb-5 text-left", larga ? "pt-6" : "pt-0")}
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden="true"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground"
              >
                <Icone className="size-5" strokeWidth={1.9} />
              </span>
              <SheetTitle className="min-w-0 flex-1 break-words text-[22px] font-bold leading-7 tracking-tight">
                {titulo}
              </SheetTitle>
              <SheetClose
                aria-label="Fechar"
                disabled={fecharBloqueado}
                className="relative inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-opacity after:absolute after:-inset-1 after:content-[''] hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X aria-hidden="true" className="size-5" />
              </SheetClose>
            </div>
            {descricao ? (
              <SheetDescription className="mt-3 text-[13px] leading-5 text-muted-foreground">
                {descricao}
              </SheetDescription>
            ) : (
              <SheetDescription className="sr-only">{titulo}</SheetDescription>
            )}
          </SheetHeader>
        </div>
        <div
          inert={descarte.perguntando}
          className="min-h-0 flex-1 overflow-y-auto px-5 pb-6"
        >
          {children}
        </div>
        {rodape ? (
          <SheetFooter
            inert={descarte.perguntando}
            className="mt-0 gap-2 border-t border-border bg-background px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-4"
          >
            {rodape}
            {larga ? null : (
              <p className="text-center text-xs text-muted-foreground">
                Arraste para baixo ou toque fora para fechar
              </p>
            )}
          </SheetFooter>
        ) : null}
        {descarte.perguntando ? (
          <PerguntaDeDescarte
            aoContinuar={descarte.aoContinuar}
            aoDescartar={descarte.aoDescartar}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
