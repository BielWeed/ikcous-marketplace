import * as SheetPrimitive from "@radix-ui/react-dialog";
import { XIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

// O onOpenChange do consumidor, publicado para o SheetContent: é por ele
// que o guardião do clique pós-fecho FECHA a folha no caminho de toque
// (quando ele mesmo engole o click — ver o guardião lá).
const ContextoFechoDaFolha = React.createContext<
  ((aberta: boolean) => void) | null
>(null);

function Sheet({
  onOpenChange,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return (
    <ContextoFechoDaFolha.Provider value={onOpenChange ?? null}>
      <SheetPrimitive.Root
        data-slot="sheet"
        onOpenChange={onOpenChange}
        {...props}
      />
    </ContextoFechoDaFolha.Provider>
  );
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />;
}

// Régua de z da casa (medida em 13/09, peça do defeito da folha): barra do
// topo 100 < BottomNav 120 < sheet modal 130 (o mesmo degrau do
// ImageAdjuster) < barra de progresso 99999 — com UM degrau transitório:
// enquanto um toast está ativo, o WRAPPER do header (BarraSuperiorCliente,
// no App) sobe para 140 para limpar o modal e o aviso da cápsula pintar
// acima do véu (revisão do bloqueante, 14/09). O degrau mora no WRAPPER e
// não no <header> interno porque este sheet é portalado em document.body:
// na raiz, quem compete contra o seu z-[130] é o wrapper (o gpu-accelerated
// dele cria stacking context) — um z condicional dentro do header era
// inerte contra o véu.
// O Sheet padrão shadcn vinha em z-50 — ATRÁS da
// BottomNav fixa — e o rodapé da folha de opções do card pintava por baixo
// da barra de navegação (CTA invisível no celular; nav nítida sobre o véu).
// Overlay E conteúdo sobem JUNTOS para o z-[130]: só o content deixaria a
// nav nítida por cima do véu; só o overlay deixaria a nav clicável por cima
// da folha. Dialog/AlertDialog seguem em z-50 (defeito latente conhecido,
// fora do escopo desta peça).
function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  return (
    <SheetPrimitive.Overlay
      data-slot="sheet-overlay"
      className={cn(
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-[130] bg-black/50",
        className,
      )}
      {...props}
    />
  );
}

// Janela de vida do guardião do clique pós-fecho, em ms: cobre o atraso
// legacy do toque (~300 ms) sem armar o guardião para um segundo gesto
// humano (um gesto inteiro de toque raramente passa de 300 ms; dois gestos
// seguidos nunca cabem aqui).
const JANELA_DO_GUARDIAO_MS = 450;

// Guardiões órfãos de fechos anteriores: eles sobrevivem à desmontagem da
// própria folha DE PROPÓSITO (o click atravessado chega depois dela sair do
// DOM) — e morrem ao ver o próximo pointerdown (novo gesto), no primeiro
// click que avaliarem, na janela abaixo, ou QUANDO UMA NOVA FOLHA MONTA
// (o gesto que montou a folha nova já é prova de gesto novo — sem isso,
// um click de abertura sem pointerdown próprio, como o `click()` dos
// testes, seria engolido injustamente).
const guardioesOrfaos = new Set<() => void>();

function matarGuardioesOrfaos() {
  for (const destruir of [...guardioesOrfaos]) destruir();
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left";
  // Peça 09 (14/09): folhas que têm caminho de fechar próprio (ex.: a folha
  // de opções do card, fechável pela alça) passam false para não herdar o X
  // embutido. O default mantém o X em todo consumidor que não decidir nada
  // (ex.: folha de filtros da busca) — leitor de tela nunca fica sem saída.
  showCloseButton?: boolean;
}) {
  // Callback ref, não useRef: o Portal do Radix nasce `mounted=false` e só
  // renderiza os filhos DEPOIS do primeiro layout-effect — um useRef lido no
  // useEffect de estreia vê null. O estado via callback ref re-roda este
  // efeito no commit em que o content de verdade anexa (e no desanexar).
  const [noConteudo, setNoConteudo] = React.useState<HTMLDivElement | null>(
    null,
  );
  // O fecho oficial da folha (o onOpenChange do consumidor), lido pelo
  // guardião do clique pós-fecho no caminho de toque.
  const fecharFolha = React.useContext(ContextoFechoDaFolha);

  // GUARDIÃO DO CLIQUE PÓS-FECHO (14/09 — "clicar fora tem que SÓ fechar",
  // relato do dono ao vivo, reproduzido com espião: o clique que fechava a
  // folha de opções acionava o card de fundo e o app navegava — pushState 1
  // ms depois do click). DOIS mecanismos medidos:
  //   a) no dist do Radix (react-dialog 1.1.15 → dismissable-layer 1.1.11):
  //      o dismiss mora no POINTERDOWN (para toque, é ADIADO para o próprio
  //      click, num listener once no document); na janela do fecho o véu e a
  //      folha saem do DOM, o body destrava (pointer-events), e o click
  //      sintetizado do MESMO gesto cai no elemento que ficou por baixo;
  //   b) ao vivo no browser: o véu é descendente REACT de quem monta a folha
  //      (portal borbulha na ÁRVORE REACT) — o click nele rodava o onClick
  //      do consumidor (o wrapper clicável do card) e NAVEGAVA, mesmo com o
  //      véu vivo na animação de saída.
  // Enquanto este content está montado, um detector de gesto (capture no
  // document) arma, para cada gesto que começa FORA da folha, UM guardião
  // de click (capture) — e o guardião decide por clique, nesta ordem:
  //   1. alvo dentro de QUALQUER folha viva → deixa passar (clique legítimo
  //      dentro de folha, inclusive de outra folha aberta por cima);
  //   2. alvo FORA e folha viva: no toque o fecho ainda vai acontecer NESTE
  //      click — então o guardião engole-o e fecha POR CONTA (fecharFolha),
  //      antes de qualquer handler React do consumidor; no mouse o fecho já
  //      aconteceu no pointerdown e o click é lixo do gesto: só engole;
  //   3. alvo FORA e folha já fora do DOM — clique órfão do gesto que só
  //      queria fechar: engole (preventDefault + stopPropagation +
  //      stopImmediatePropagation, na fase de captura), antes do container
  //      do React e de qualquer handler de fundo.
  // O guardião se autodestrói no primeiro click avaliado (usado ou não), no
  // PRIMEIRO pointerdown seguinte (novo gesto = novo direito ao click — um
  // clique legítimo logo após o fecho não pode ser engolido) ou na janela
  // JANELA_DO_GUARDIAO_MS — sem listener órfão. Escape não participa (não
  // gera clique). O cleanup do efeito NÃO mata guardião armado de propósito:
  // ele existe exatamente para o clique DEPOIS deste content sair da árvore —
  // e a closure segura o nó que desanexou.
  React.useEffect(() => {
    // Uma folha nova no ar invalida guardiões órfãos de fechos anteriores —
    // uma vez por MONTAGEM deste content (efeito sem deps: no fecho o efeito
    // do guardião re-roda, e NÃO é ele quem decide o fim dos órfãos).
    matarGuardioesOrfaos();
  }, []);

  React.useEffect(() => {
    const el = noConteudo;
    if (!el) return;

    let guardiao: ((evento: MouseEvent) => void) | null = null;
    let timer: number | undefined;
    let gestoDeToque = false;

    const destruirGuardiao = () => {
      if (guardiao) document.removeEventListener("click", guardiao, true);
      document.removeEventListener("pointerdown", destruirGuardiao, true);
      guardioesOrfaos.delete(destruirGuardiao);
      guardiao = null;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };

    const instalarGuardiao = () => {
      if (guardiao) return; // um guardião por gesto
      guardiao = (evento) => {
        destruirGuardiao();
        const alvo = evento.target;
        // 1) clique dentro de qualquer folha viva não é coisa de fecho.
        if (
          alvo instanceof Element &&
          alvo.closest('[data-slot="sheet-content"]')
        ) {
          return;
        }
        // 2) folha viva: no toque o fecho seria ESTE click — engole-o e
        //    fecha por conta; no mouse o fecho já foi no pointerdown.
        if (el.isConnected) {
          if (gestoDeToque && fecharFolha) {
            fecharFolha(false);
          } else if (!(gestoDeToque && !fecharFolha)) {
            // mouse: engole. Toque SEM onOpenChange (folha que não sabe
            // fechar por fora): deixa passar como sempre foi.
            evento.preventDefault();
            evento.stopPropagation();
            evento.stopImmediatePropagation();
          }
          return;
        }
        // 3) fecho consumado: clique órfão morre antes de atingir o fundo.
        evento.preventDefault();
        evento.stopPropagation();
        evento.stopImmediatePropagation();
      };
      document.addEventListener("click", guardiao, true);
      // UM NOVO pointerdown é um NOVO gesto físico — e nenhum click nasce
      // sem pointerdown. O guardião existe para o click do MESMO gesto que
      // o armou; o próximo gesto do usuário desarma-o ANTES do click dele
      // (sem isso, um clique legítimo logo após o fecho era engolido à toa).
      document.addEventListener("pointerdown", destruirGuardiao, true);
      guardioesOrfaos.add(destruirGuardiao);
      timer = window.setTimeout(destruirGuardiao, JANELA_DO_GUARDIAO_MS);
    };

    const noGesto = (evento: Event) => {
      gestoDeToque =
        (evento as PointerEvent).pointerType === "touch" ? true : gestoDeToque;
      if (evento.target instanceof Node && !el.contains(evento.target)) {
        instalarGuardiao();
      }
    };
    document.addEventListener("pointerdown", noGesto, true);
    document.addEventListener("pointerup", noGesto, true);
    return () => {
      document.removeEventListener("pointerdown", noGesto, true);
      document.removeEventListener("pointerup", noGesto, true);
    };
  }, [noConteudo, fecharFolha]);

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content
        ref={setNoConteudo}
        data-slot="sheet-content"
        className={cn(
          "bg-background data-[state=open]:animate-in data-[state=closed]:animate-out fixed z-[130] flex flex-col gap-4 shadow-lg transition ease-in-out data-[state=closed]:duration-300 data-[state=open]:duration-500",
          side === "right" &&
            "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
          side === "left" &&
            "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
          side === "top" &&
            "data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b",
          side === "bottom" &&
            "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            aria-label="Fechar"
            className="focus:outline-hidden absolute right-4 top-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-secondary"
          >
            <XIcon className="size-4" />
            <span className="sr-only">Close</span>
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Content>
    </SheetPortal>
  );
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  );
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  );
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-foreground font-semibold", className)}
      {...props}
    />
  );
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
};
