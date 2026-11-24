import { AlcaDaFolha } from "@/components/admin/primitivos/AlcaDaFolha";
import { type CSSProperties, type ReactNode, useEffect } from "react";

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
import { X } from "lucide-react";

/**
 * A folha das Vitrines: sobe de baixo (o polegar alcança), corpo que rola
 * sozinho e rodapé com a ação principal sempre à vista. No computador o
 * Sheet compartilhado a posiciona como gaveta à direita.
 *
 * Quem fecha é SEMPRE `aoFechar` (X, véu e Esc) — a folha não guarda estado.
 *
 * Ao abrir, o foco vai para a própria folha e NÃO para o primeiro campo: o
 * campo de nome sozinho no foco levantava o teclado do celular por cima da
 * lista de produtos, e ainda gravava (blur do campo) a cada abrir/fechar.
 */
export function FolhaInferior({
  titulo,
  descricao,
  aoFechar,
  aoRestaurarFoco,
  children,
  rodape,
}: {
  readonly titulo: string;
  readonly descricao: ReactNode;
  readonly aoFechar: () => void;
  readonly aoRestaurarFoco?: (evento: Event) => void;
  readonly children: ReactNode;
  readonly rodape: ReactNode;
}) {
  // O teclado do celular se SOBREPÕE à página (não a redimensiona): a folha sobe
  // acima dele e cabe na área visível, para o botão principal do rodapé (Criar,
  // Salvar) não ficar escondido ao digitar o nome ou buscar produto. Vai por
  // variável CSS lida só nas classes do celular: a gaveta do computador (`lg:`)
  // não muda, e um `bottom` inline venceria o `lg:bottom-auto`.
  const { altura: teclado, alturaVisivel } = useAlturaDoTeclado();
  // Ao focar um campo, traz ele à vista dentro do corpo que rola (o teclado
  // leva um tempo para abrir: o segundo efeito refaz a rolagem).
  useEffect(() => {
    let timer: number | undefined;
    const aoFocar = (evento: FocusEvent) => {
      const alvo = evento.target;
      if (!(alvo instanceof HTMLElement)) return;
      if (alvo.tagName !== "INPUT" && alvo.tagName !== "TEXTAREA") return;
      if (!alvo.closest("[data-folha-inferior]")) return;
      window.clearTimeout(timer);
      // `?.`: o jsdom dos testes não tem a função.
      timer = window.setTimeout(
        () => alvo.scrollIntoView?.({ block: "nearest" }),
        150,
      );
    };
    document.addEventListener("focusin", aoFocar);
    return () => {
      document.removeEventListener("focusin", aoFocar);
      window.clearTimeout(timer);
    };
  }, []);
  useEffect(() => {
    if (teclado === 0) return;
    const ativo = document.activeElement;
    if (!(ativo instanceof HTMLElement)) return;
    if (ativo.tagName !== "INPUT" && ativo.tagName !== "TEXTAREA") return;
    if (!ativo.closest("[data-folha-inferior]")) return;
    ativo.scrollIntoView?.({ block: "nearest" });
  }, [teclado]);
  return (
    <Sheet
      open
      onOpenChange={(aberta) => {
        if (!aberta) aoFechar();
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        onCloseAutoFocus={aoRestaurarFoco}
        onOpenAutoFocus={(evento) => {
          evento.preventDefault();
          (evento.currentTarget as HTMLElement | null)?.focus();
        }}
        data-folha-inferior=""
        style={
          teclado > 0
            ? ({
                "--teclado-da-folha": `${teclado}px`,
                "--altura-da-folha": `calc(${alturaVisivel}px - 1rem)`,
              } as CSSProperties)
            : undefined
        }
        className="bottom-[var(--teclado-da-folha,0px)] mx-auto max-h-[min(92dvh,var(--altura-da-folha,92dvh))] w-full gap-0 rounded-t-[28px] border-admin-border bg-zinc-950 p-0 text-white sm:max-w-xl"
      >
        <SheetHeader className="px-5 pb-1 pt-3 text-left">
          <AlcaDaFolha
            aoFechar={aoFechar}
            className="-mb-1"
            barra="bg-white/15"
          />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle className="text-lg font-extrabold tracking-tight text-white">
                {titulo}
              </SheetTitle>
              <SheetDescription className="mt-0.5 text-xs text-zinc-400">
                {descricao}
              </SheetDescription>
            </div>
            <SheetClose
              aria-label="Fechar"
              className="relative flex size-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-zinc-400 transition-colors after:absolute after:-inset-1.5 hover:text-white"
            >
              <X className="size-4" />
            </SheetClose>
          </div>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {children}
        </div>
        <SheetFooter className="mt-0 flex-row items-center gap-2.5 border-t border-admin-border px-5 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3">
          {rodape}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
