import { AlcaDaFolha } from "@/components/admin/primitivos/AlcaDaFolha";
import { useFolhaSobeComOTeclado } from "@/hooks/useFolhaSobeComOTeclado";
import { useVoltarFechaAFolha } from "@/hooks/useVoltarFechaAFolha";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode, RefObject } from "react";

/**
 * A lista no CELULAR: folha de baixo (o polegar alcança), com alça, título e
 * Fechar. Radix Dialog direto, como a `FolhaDoPainel` — sem `ui/sheet`, que é
 * compartilhado com a loja.
 *
 * Camada 135: acima da FolhaFinanceira (130), da BottomNav (120) e da
 * FolhaDoPainel (100), abaixo do degrau transitório do aviso (140). Por ser o
 * MESMO Radix Dialog das folhas, entra na mesma pilha: tocar no véu ou
 * apertar Esc fecha só a lista, nunca a folha de baixo.
 *
 * O Voltar do aparelho fecha só a lista (`antesDaGuarda`: o App entrega o
 * Voltar a ela antes da guarda da tela).
 */
export function FolhaDaLista({
  aberta,
  aoFechar,
  titulo,
  botaoRef,
  aoFocarAoAbrir,
  children,
}: {
  readonly aberta: boolean;
  readonly aoFechar: () => void;
  readonly titulo: string;
  /** O campo que abriu: recebe o foco de volta ao fechar. */
  readonly botaoRef: RefObject<HTMLButtonElement | null>;
  /** Decide quem recebe o foco ao abrir (nunca a busca, no celular). */
  readonly aoFocarAoAbrir: (conteudo: HTMLElement) => void;
  readonly children: ReactNode;
}) {
  // O teclado da busca sobe a folha em vez de cobrir as opções de baixo.
  const estiloDoTeclado = useFolhaSobeComOTeclado("data-folha-da-lista");
  useVoltarFechaAFolha(aberta, aoFechar, true);

  return (
    <DialogPrimitive.Root
      open={aberta}
      onOpenChange={(abrir) => {
        if (!abrir) aoFechar();
      }}
    >
      <DialogPrimitive.Portal>
        {/* O véu do painel NÃO pode ser `bg-black/50`: nos temas Claro e
            Confortável a regra gerada troca essa classe pelo fundo opaco do
            painel. rgb() escapa da troca. */}
        <DialogPrimitive.Overlay
          data-lista-de-escolha="veu"
          className="fixed inset-0 z-[135] bg-[rgb(0_0_0/0.5)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
        />
        <DialogPrimitive.Content
          data-lista-de-escolha="folha"
          data-folha-da-lista=""
          // Sem descrição própria: o título já nomeia a folha.
          aria-describedby={undefined}
          onOpenAutoFocus={(evento) => {
            evento.preventDefault();
            aoFocarAoAbrir(evento.currentTarget as HTMLElement);
          }}
          onCloseAutoFocus={(evento) => {
            evento.preventDefault();
            botaoRef.current?.focus();
          }}
          style={estiloDoTeclado}
          // `lista-de-escolha-sem-anel`: com busca, o foco mora na própria
          // folha, e o anel verde do painel a contornava inteira.
          className="lista-de-escolha-sem-anel fixed inset-x-0 bottom-[var(--teclado-da-folha,0px)] z-[135] mx-auto flex max-h-[min(85dvh,var(--altura-da-folha,85dvh))] w-full flex-col rounded-t-[28px] border border-b-0 border-admin-border bg-admin-surface pb-[env(safe-area-inset-bottom,0px)] shadow-2xl outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom sm:max-w-xl"
        >
          <AlcaDaFolha
            aoFechar={aoFechar}
            className="mt-0 h-7 items-center"
            barra="mt-0 bg-muted-foreground/40"
          />
          <div className="flex shrink-0 items-center justify-between gap-3 px-5 pb-3">
            <DialogPrimitive.Title className="lista-de-escolha-texto min-w-0 break-words text-xl font-bold leading-7 tracking-tight">
              {titulo}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Fechar"
              className="lista-de-escolha-anel flex size-11 shrink-0 items-center justify-center rounded-full bg-admin-raised text-muted-foreground outline-none transition-colors hover:bg-admin-hover"
            >
              <X aria-hidden="true" className="size-5" />
            </DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
