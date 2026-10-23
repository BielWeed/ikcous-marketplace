import {
  AvisoDeProblema,
  BOTAO_NEUTRO,
} from "@/components/admin/atendimento/controles";
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
import { cn } from "@/lib/utils";
import { Loader2, Send, X } from "lucide-react";
import { useEffect } from "react";

/**
 * Folha de baixo para responder uma pergunta (desenho aprovado em 22/10/2026).
 *
 * Sobe de baixo no celular; no computador ocupa a largura toda embaixo e o
 * conteúdo fica numa coluna centralizada. O teclado do celular se SOBREPÕE à
 * página: a folha sobe acima dele (`useAlturaDoTeclado`, o mesmo padrão da
 * folha "Abrir caixa" do Financeiro) e, ao focar o campo, ele é trazido à
 * vista — o campo de resposta nunca fica atrás do teclado.
 *
 * Quem decide fechar é SEMPRE `aoFechar` (X, véu, Esc, Descartar): ele
 * pergunta antes de jogar fora um texto digitado.
 */
export function FolhaDeResposta({
  aberta,
  aoFechar,
  cliente,
  produto,
  pergunta,
  resposta,
  aoMudarResposta,
  aoPublicar,
  enviando,
  semConexao,
}: {
  readonly aberta: boolean;
  readonly aoFechar: () => void;
  readonly cliente: string;
  readonly produto: string | undefined;
  readonly pergunta: string;
  readonly resposta: string;
  readonly aoMudarResposta: (texto: string) => void;
  readonly aoPublicar: () => void;
  readonly enviando: boolean;
  readonly semConexao: boolean;
}) {
  const { altura: teclado, alturaVisivel } = useAlturaDoTeclado();

  // Ao focar o campo, traz ele à vista dentro do corpo que rola (o teclado
  // leva um tempo para abrir: o segundo efeito refaz a rolagem quando a
  // altura dele muda).
  useEffect(() => {
    if (!aberta) return;
    let timer: number | undefined;
    const aoFocar = (evento: FocusEvent) => {
      const alvo = evento.target;
      if (!(alvo instanceof HTMLElement) || alvo.tagName !== "TEXTAREA") return;
      if (!alvo.closest("[data-folha-de-resposta]")) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(
        // `?.`: o jsdom dos testes não tem a função.
        () => alvo.scrollIntoView?.({ block: "nearest" }),
        150,
      );
    };
    document.addEventListener("focusin", aoFocar);
    return () => {
      document.removeEventListener("focusin", aoFocar);
      window.clearTimeout(timer);
    };
  }, [aberta]);
  useEffect(() => {
    if (!aberta || teclado === 0) return;
    const ativo = document.activeElement;
    if (!(ativo instanceof HTMLElement) || ativo.tagName !== "TEXTAREA") return;
    if (!ativo.closest("[data-folha-de-resposta]")) return;
    ativo.scrollIntoView?.({ block: "nearest" });
  }, [aberta, teclado]);

  const comTeclado = teclado > 0;
  const legenda = [cliente, produto].filter(Boolean).join(" · ");

  return (
    <Sheet
      open={aberta}
      onOpenChange={(abrir) => {
        if (!abrir) aoFechar();
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-folha-de-resposta=""
        style={
          comTeclado
            ? {
                bottom: teclado,
                maxHeight: `calc(${alturaVisivel}px - 1rem)`,
              }
            : undefined
        }
        className="max-h-[94dvh] gap-0 rounded-t-3xl border-admin-border bg-admin-bg p-0 text-white"
      >
        <div className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col">
          <SheetHeader className="flex-row items-start justify-between gap-3 px-5 pb-3 pt-5 text-left">
            <div className="min-w-0">
              <SheetTitle className="text-xl font-bold leading-tight text-white">
                Responder pergunta
              </SheetTitle>
              <SheetDescription className="mt-1 truncate text-sm text-zinc-300">
                {legenda}
              </SheetDescription>
            </div>
            <SheetClose
              aria-label="Fechar"
              className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl border border-solid border-admin-border-strong bg-admin-raised text-zinc-200"
            >
              <X aria-hidden="true" className="size-5" />
            </SheetClose>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4">
            <div className="rounded-2xl border border-solid border-admin-border bg-admin-surface p-3.5">
              <span className="block text-sm font-medium text-zinc-300">
                Pergunta
              </span>
              <p className="mt-1 whitespace-pre-wrap break-words text-base italic text-zinc-100">
                “{pergunta}”
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3">
                <label
                  htmlFor="merchant-answer"
                  className="text-sm font-bold text-white"
                >
                  Sua resposta
                </label>
                <span className="text-sm tabular-nums text-zinc-300">
                  {resposta.length} caracteres
                </span>
              </div>
              <textarea
                id="merchant-answer"
                name="answer"
                autoComplete="off"
                value={resposta}
                onChange={(e) => aoMudarResposta(e.target.value)}
                disabled={semConexao || enviando}
                placeholder={
                  semConexao
                    ? "Você está offline. Não é possível responder no momento."
                    : "Escreva uma resposta clara para a cliente"
                }
                className="h-36 w-full resize-none rounded-2xl border border-solid border-admin-border-strong bg-admin-bg p-3.5 text-base text-white placeholder:text-zinc-400 focus:outline-none focus-visible:outline focus-visible:outline-2 disabled:opacity-40"
              />
              <p className="flex items-center gap-2 text-sm text-zinc-300">
                <Send aria-hidden="true" className="size-4 shrink-0" />
                Avisa a cliente no app
              </p>
            </div>

            {semConexao && (
              <AvisoDeProblema>
                Sem conexão. Não dá para enviar a resposta agora.
              </AvisoDeProblema>
            )}
          </div>

          <SheetFooter className="mt-0 flex-row gap-2 border-t border-admin-border bg-admin-surface px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] pt-3">
            <button
              type="button"
              onClick={aoFechar}
              className={cn(BOTAO_NEUTRO, "min-h-12 flex-1 bg-transparent")}
            >
              Descartar
            </button>
            <button
              type="button"
              onClick={aoPublicar}
              disabled={enviando || !resposta.trim() || semConexao}
              className={cn(BOTAO_NEUTRO, "min-h-12 flex-[2]")}
            >
              {enviando ? (
                <>
                  <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send aria-hidden="true" className="size-4" />
                  Publicar resposta
                </>
              )}
            </button>
          </SheetFooter>
        </div>
      </SheetContent>
    </Sheet>
  );
}
