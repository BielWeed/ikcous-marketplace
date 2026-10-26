import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import {
  type EscolhaDeIcone,
  SeletorDeIcone,
} from "@/components/admin/categorias/SeletorDeIcone";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ErroDeCategoria, categoriaParecida } from "@/lib/gestao-de-categorias";
import type { Category } from "@/types";
import { Loader2, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

const AVISO_ICONE_NAO_SALVO =
  "Categoria criada, mas o ícone não foi salvo. Escolha o ícone em Organizar categorias.";

const BOTAO =
  "flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-solid px-3 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";

/**
 * Folha de baixo "Nova categoria" do formulário de produto (no lugar da janela
 * antiga). Nome + galeria de ícones (a mesma de Gerenciar categorias, já aberta).
 *
 * Só existe montada enquanto está aberta: o formulário a baixa sob demanda
 * (`lazy`) e fechar a desmonta, então nome e ícone escolhidos nascem vazios
 * a cada abertura. Fechar é SEMPRE `aoFechar` (X, Cancelar, Esc e toque fora).
 *
 * Criar é em dois passos, de propósito:
 *  1. `adicionar` cria a categoria SEM ícone (não grava as colunas de ícone: uma
 *     loja com banco sem elas quebraria na criação);
 *  2. só se a lojista escolheu um ícone, `atualizarIcone` o grava no id DEFINITIVO
 *     devolvido pelo passo 1. Se este passo falha, a categoria já existe: fica
 *     escolhida no formulário e a lojista é avisada (sem tom de erro).
 */
export function FolhaDeNovaCategoria({
  categoriasDaLoja,
  adicionar,
  atualizarIcone,
  aoCriada,
  aoFechar,
}: {
  /** As categorias que já existem (para avisar nome parecido ANTES de criar). */
  readonly categoriasDaLoja: ReadonlyArray<{
    readonly name: string;
    readonly slug?: string | null;
  }>;
  readonly adicionar: (
    categoria: Omit<Category, "id" | "createdAt" | "slug">,
    silencioso: boolean,
  ) => Promise<{ readonly id: string } | null | undefined>;
  readonly atualizarIcone: (
    id: string,
    icone: { icone: string | null; iconeForma: string | null },
    silencioso: boolean,
  ) => Promise<unknown>;
  /** A categoria existe: o formulário a escolhe (recebe o nome). */
  readonly aoCriada: (nome: string) => void;
  readonly aoFechar: () => void;
}) {
  const [nome, setNome] = useState("");
  const [escolha, setEscolha] = useState<EscolhaDeIcone>({
    icone: null,
    forma: null,
  });
  // "Criar categoria" em andamento: tudo fica desligado e um segundo toque (no
  // mesmo instante, antes de a tela refletir o estado) não cria outra. O `ref`
  // fecha a janela entre o toque e a tela se atualizar.
  const [criando, setCriando] = useState(false);
  const criandoRef = useRef(false);

  const nomeLimpo = nome.trim();

  const fechar = () => {
    if (criandoRef.current) return;
    aoFechar();
  };

  const criar = async () => {
    if (criandoRef.current || !nomeLimpo) return;
    // O banco tem nome único e endereço único: "Vestuário" e "vestuario"
    // colidem. Avisa ANTES, com o nome da que já existe, em vez do erro
    // genérico depois.
    const parecida = categoriaParecida(nomeLimpo, categoriasDaLoja);
    if (parecida) {
      toast.error(`Já existe uma categoria parecida: ${parecida.name}`);
      return;
    }
    criandoRef.current = true;
    setCriando(true);
    const loadingId = toast.loading("Criando categoria...");
    try {
      const criada = await adicionar(
        { name: nomeLimpo, description: "", isActive: true },
        true,
      );
      aoCriada(nomeLimpo);
      const comIcone = escolha.icone !== null || escolha.forma !== null;
      if (!comIcone) {
        toast.success("Categoria criada com sucesso!", { id: loadingId });
      } else {
        let iconeSalvo = false;
        try {
          if (criada?.id) {
            await atualizarIcone(
              criada.id,
              { icone: escolha.icone, iconeForma: escolha.forma },
              true,
            );
            iconeSalvo = true;
          }
        } catch {
          // A categoria já existe: só o ícone ficou de fora.
        }
        if (iconeSalvo) {
          toast.success("Categoria criada com sucesso!", { id: loadingId });
        } else {
          toast.warning(AVISO_ICONE_NAO_SALVO, { id: loadingId });
        }
      }
      aoFechar();
    } catch (e) {
      toast.error(
        e instanceof ErroDeCategoria ? e.message : "Erro ao salvar categoria",
        { id: loadingId },
      );
    } finally {
      criandoRef.current = false;
      setCriando(false);
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(aberta) => {
        if (!aberta) fechar();
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        aria-labelledby="titulo-da-categoria"
        // O véu do painel NÃO pode ser `bg-black/50`: nos temas Claro e
        // Confortável a regra gerada troca essa classe pelo fundo opaco do
        // painel e o formulário por trás some. rgb() escapa da troca.
        overlayClassName="bg-[rgb(0_0_0/0.5)]"
        // Ao abrir, o foco vai para a própria folha e NÃO para o campo: o
        // teclado do celular não pode subir por cima da galeria de ícones.
        onOpenAutoFocus={(evento) => {
          evento.preventDefault();
          (evento.currentTarget as HTMLElement | null)?.focus();
        }}
        // Sem botão que a abriu, o foco volta para o campo "Categoria".
        onCloseAutoFocus={(evento) => {
          evento.preventDefault();
          document.getElementById("product-category")?.focus();
        }}
        className="mx-auto max-h-[92dvh] w-full gap-0 rounded-t-[28px] border-admin-border bg-admin-bg p-0 text-foreground sm:max-w-xl"
      >
        <SheetHeader className="gap-0 px-5 pb-3 pt-0 text-left">
          <div
            aria-hidden="true"
            className="flex h-7 items-center justify-center"
          >
            <span className="h-1 w-10 rounded-full bg-muted-foreground/40" />
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <SheetTitle
                id="titulo-da-categoria"
                className="text-[22px] font-bold leading-7 tracking-tight text-foreground"
              >
                Nova categoria
              </SheetTitle>
              <SheetDescription className="mt-0.5 text-[13px] text-muted-foreground">
                O ícone é opcional: sem escolher, a loja usa um pelo nome.
              </SheetDescription>
            </div>
            <SheetClose
              aria-label="Fechar"
              disabled={criando}
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-admin-raised text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            >
              <X aria-hidden="true" className="size-5" />
            </SheetClose>
          </div>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 pb-4">
          <div className="space-y-1.5">
            <label
              htmlFor="cat-name"
              className="ml-1 block text-[13px] font-semibold text-muted-foreground"
            >
              Nome da categoria
            </label>
            <LocalBufferedInput
              id="cat-name"
              name="categoryName"
              type="text"
              delay={150}
              value={nome}
              onFlush={setNome}
              readOnly={criando}
              autoComplete="off"
              enterKeyHint="done"
              className="min-h-11 w-full rounded-xl border border-solid border-admin-border bg-admin-surface px-4 py-3 text-base font-semibold text-foreground placeholder:font-normal placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Ex.: Vestuário"
            />
          </div>

          <SeletorDeIcone
            modo="direto"
            nomeDaCategoria={nomeLimpo || "nova categoria"}
            nomeParaSugerir={nomeLimpo}
            gravado={{ icone: escolha.icone, forma: escolha.forma }}
            desabilitado={criando}
            aoEscolher={setEscolha}
          />
        </div>

        <SheetFooter className="mt-0 flex-row gap-3 border-t border-admin-border px-5 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3">
          <button
            type="button"
            onClick={fechar}
            disabled={criando}
            className={`${BOTAO} flex-1 border-admin-border-strong bg-admin-raised text-foreground hover:bg-admin-hover`}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void criar()}
            disabled={criando}
            // Nome vazio: só `aria-disabled`, sem `disabled`. O nome digitado
            // chega à folha quando o campo perde o foco, e o toque neste botão
            // é quem tira o foco: um `disabled` aqui engoliria esse primeiro toque.
            aria-disabled={!nomeLimpo}
            className={`${BOTAO} flex-[2] border-foreground bg-foreground text-background hover:opacity-90 aria-disabled:cursor-not-allowed aria-disabled:opacity-40`}
          >
            {criando ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : null}
            Criar categoria
          </button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
