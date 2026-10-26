import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useIconesPeloNome } from "@/hooks/useIconesPeloNome";
import { IconeDaCategoria, iconeDaCategoria } from "@/lib/icones-de-categoria";
import { cn, normalizeText } from "@/lib/utils";
import { haptic } from "@/utils/haptic";
import { ChevronRight, Pencil, Plus, Search, X } from "lucide-react";
import { useRef, useState } from "react";

/** Abaixo disto a lista cabe na tela sem buscar: o campo de busca só atrapalharia. */
const CATEGORIAS_PARA_BUSCAR = 6;

/** O que o campo precisa saber de cada categoria. `icone`/`iconeForma` são o que a lojista salvou. */
export interface CategoriaDoCampo {
  readonly id: string;
  readonly nome: string;
  readonly icone?: string | null;
  readonly iconeForma?: string | null;
}

/**
 * PONTO DE INTEGRAÇÃO DA CATEGORIA no formulário de produto.
 *
 * Campo "Categoria" em forma de galeria: fechado, é um botão grande com o ícone
 * e o nome da categoria escolhida; ao tocar, uma folha de baixo mostra todas as
 * categorias da loja em cartões com ícone (os mesmos da vitrine), mais "Nova
 * categoria" e "Organizar categorias". Contrato com o formulário:
 *  - `id="product-category"` no controle que recebe o foco (o formulário e os
 *    testes encontram o campo por ele);
 *  - `valor` é o NOME da categoria ("" = nenhuma); `aoEscolher(nome)` devolve
 *    o nome;
 *  - `aoCriar` / `aoGerenciar` abrem as folhas que o formulário já controla
 *    (esta folha fecha antes);
 *  - `categoriaDoRascunhoQueSumiu` mostra o recado de rascunho com categoria
 *    apagada (só enquanto `valor === ""`).
 *
 * `nomes` vem na ordem que o formulário quer e só com as categorias à mostra
 * na loja. Um `valor` que NÃO está nessa lista (categoria apagada ou escondida
 * depois de o produto ser salvo) continua aparecendo no campo fechado, com o
 * ícone de etiqueta: o produto não perde a categoria só por ela ter saído da lista.
 *
 * Texto em letra normal (antes saía tudo em CAIXA-ALTA).
 */
export function CampoDeCategoria({
  valor,
  nomes,
  aoEscolher,
  aoCriar,
  aoGerenciar,
  categoriaDoRascunhoQueSumiu,
}: {
  readonly valor: string;
  readonly nomes: ReadonlyArray<CategoriaDoCampo>;
  readonly aoEscolher: (nome: string) => void;
  readonly aoCriar: () => void;
  readonly aoGerenciar: () => void;
  readonly categoriaDoRascunhoQueSumiu: string | null;
}) {
  const [aberta, setAberta] = useState(false);
  const [busca, setBusca] = useState("");
  const botaoRef = useRef<HTMLButtonElement | null>(null);
  // "Nova categoria" e "Organizar" abrem OUTRA folha no mesmo instante: devolver
  // o foco ao botão do campo, depois, roubaria o foco dela.
  const devolverFocoRef = useRef(true);

  // Sem ícone salvo, o do catálogo que combina com o nome (o mesmo da vitrine).
  const pelosNomes = useIconesPeloNome(
    nomes.map((c) => ({
      name: c.nome,
      icone: c.icone,
      iconeForma: c.iconeForma,
    })),
    aberta || valor !== "",
  );
  const desenho = (c: CategoriaDoCampo) => {
    const sugerido =
      c.icone || c.iconeForma ? undefined : pelosNomes.get(c.nome);
    return {
      icone:
        sugerido?.icone ?? iconeDaCategoria({ name: c.nome, icone: c.icone }),
      forma: c.iconeForma ?? sugerido?.forma,
    } as const;
  };

  const chave = normalizeText(valor);
  const escolhida = chave
    ? (nomes.find((c) => normalizeText(c.nome) === chave) ?? null)
    : null;
  const comEscolha = valor !== "";
  const visual = escolhida
    ? desenho(escolhida)
    : ({ icone: "etiqueta", forma: null } as const);

  const comBusca = nomes.length > CATEGORIAS_PARA_BUSCAR;
  const termo = comBusca ? normalizeText(busca) : "";
  const visiveis = termo
    ? nomes.filter((c) => normalizeText(c.nome).includes(termo))
    : nomes;

  const mudarAberta = (abrir: boolean) => {
    if (abrir) {
      setBusca("");
      devolverFocoRef.current = true;
    }
    setAberta(abrir);
  };
  const fecharEFazer = (acao: () => void, devolverFoco: boolean) => {
    devolverFocoRef.current = devolverFoco;
    setAberta(false);
    acao();
  };

  return (
    <div className="produto-campo col-span-2 space-y-1">
      <label
        id="product-category-label"
        htmlFor="product-category"
        className="ml-1 block text-[11px] text-zinc-400"
      >
        Categoria *
      </label>
      <button
        ref={botaoRef}
        id="product-category"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={aberta}
        // O rótulo nativo sozinho taparia o valor ("Categoria *, botão").
        aria-labelledby="product-category-label product-category-valor"
        aria-describedby="product-category-dica"
        onClick={() => mudarAberta(true)}
        className={cn(
          "flex min-h-[68px] w-full items-center gap-3 rounded-[20px] border-[1.5px] border-solid bg-admin-surface px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40",
          comEscolha
            ? "border-emerald-500/50 hover:border-emerald-500"
            : "border-admin-border-strong hover:bg-admin-raised",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-[14px]",
            comEscolha
              ? "bg-emerald-500 text-emerald-950"
              : "bg-admin-raised text-muted-foreground",
          )}
        >
          <IconeDaCategoria
            icone={visual.icone}
            forma={visual.forma}
            className="size-5"
          />
        </span>
        <span className="min-w-0 flex-1">
          <span
            id="product-category-valor"
            className="block truncate text-base font-semibold text-foreground"
          >
            {comEscolha ? valor : "Escolher categoria"}
          </span>
          <span
            id="product-category-dica"
            className="block truncate text-xs text-muted-foreground"
          >
            {comEscolha
              ? "Toque para trocar"
              : "Toque para ver as categorias da loja"}
          </span>
        </span>
        <ChevronRight
          aria-hidden="true"
          className="size-5 shrink-0 text-muted-foreground"
        />
      </button>

      <Sheet open={aberta} onOpenChange={mudarAberta}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          // O véu do painel NÃO pode ser `bg-black/50`: nos temas Claro e
          // Confortável a regra gerada troca essa classe pelo fundo opaco do
          // painel e o formulário por trás some. rgb() escapa da troca.
          overlayClassName="bg-[rgb(0_0_0/0.5)]"
          // Ao abrir, o foco vai para a própria folha e NÃO para a busca: o
          // teclado do celular não pode subir por cima das categorias.
          onOpenAutoFocus={(evento) => {
            evento.preventDefault();
            (evento.currentTarget as HTMLElement | null)?.focus();
          }}
          onCloseAutoFocus={(evento) => {
            evento.preventDefault();
            if (devolverFocoRef.current) botaoRef.current?.focus();
          }}
          className="mx-auto max-h-[85dvh] w-full gap-0 rounded-t-[28px] border-admin-border bg-admin-bg p-0 text-foreground sm:max-w-xl"
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
                <SheetTitle className="text-[22px] font-bold leading-7 tracking-tight text-foreground">
                  Categoria
                </SheetTitle>
                <SheetDescription className="mt-0.5 text-[13px] text-muted-foreground">
                  Onde este produto aparece na loja
                </SheetDescription>
              </div>
              <SheetClose
                aria-label="Fechar"
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-admin-raised text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <X aria-hidden="true" className="size-5" />
              </SheetClose>
            </div>
          </SheetHeader>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-4">
            {comBusca ? (
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
                />
                <input
                  type="text"
                  value={busca}
                  onChange={(e) => setBusca(e.target.value)}
                  placeholder="Buscar categoria"
                  aria-label="Buscar categoria"
                  autoComplete="off"
                  enterKeyHint="search"
                  className="h-12 w-full rounded-2xl border border-solid border-admin-border bg-admin-surface pl-11 pr-4 text-base text-foreground placeholder:text-muted-foreground focus-visible:border-emerald-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/30"
                />
              </div>
            ) : null}

            {visiveis.length === 0 ? (
              <p className="py-2 text-center text-sm text-muted-foreground">
                {nomes.length === 0
                  ? "Você ainda não tem categorias"
                  : "Nenhuma categoria com esse nome"}
              </p>
            ) : null}

            <div className="grid grid-cols-2 gap-2.5 min-[340px]:grid-cols-3">
              {visiveis.map((c) => {
                const marcada = c === escolhida;
                const d = desenho(c);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={marcada}
                    onClick={() => {
                      haptic.light();
                      fecharEFazer(() => aoEscolher(c.nome), true);
                    }}
                    className={cn(
                      "flex min-h-[112px] min-w-0 flex-col items-center gap-2 rounded-[20px] px-2 py-3 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40",
                      marcada
                        ? "border-2 border-solid border-emerald-500 bg-emerald-500/10"
                        : "border border-solid border-admin-border bg-admin-surface hover:border-admin-border-strong hover:bg-admin-raised",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-[46px] shrink-0 items-center justify-center rounded-[15px]",
                        marcada
                          ? "bg-emerald-500 text-emerald-950"
                          : "bg-admin-raised text-foreground",
                      )}
                    >
                      <IconeDaCategoria
                        icone={d.icone}
                        forma={d.forma}
                        className="size-6"
                      />
                    </span>
                    <span
                      className={cn(
                        "line-clamp-2 w-full break-words text-balance text-[13px] font-semibold leading-tight",
                        marcada ? "text-emerald-400" : "text-foreground",
                      )}
                    >
                      {c.nome}
                    </span>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => fecharEFazer(aoCriar, false)}
                className={cn(
                  "flex min-h-[112px] min-w-0 flex-col items-center gap-2 rounded-[20px] border border-solid bg-admin-surface px-2 py-3 text-center transition-colors hover:bg-admin-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40",
                  nomes.length === 0 || termo
                    ? "border-emerald-500/60"
                    : "border-admin-border-strong",
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex size-[46px] shrink-0 items-center justify-center rounded-[15px] bg-emerald-500/10 text-emerald-400"
                >
                  <Plus className="size-6" />
                </span>
                <span className="w-full text-balance text-[13px] font-semibold leading-tight text-emerald-400">
                  Nova categoria
                </span>
              </button>
            </div>
          </div>

          <SheetFooter className="mt-0 gap-0 border-t border-admin-border px-5 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-3">
            <button
              type="button"
              onClick={() => fecharEFazer(aoGerenciar, false)}
              className="flex min-h-[52px] w-full items-center justify-center gap-2 rounded-2xl border border-solid border-admin-border-strong bg-admin-raised text-sm font-bold text-foreground transition-colors hover:bg-admin-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Pencil aria-hidden="true" className="size-4" />
              Organizar categorias
            </button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {categoriaDoRascunhoQueSumiu && valor === "" ? (
        <p
          role="alert"
          data-testid="categoria-do-rascunho-sumiu"
          className="ml-1 text-xs font-bold text-amber-300"
        >
          A categoria “{categoriaDoRascunhoQueSumiu}” do rascunho não existe
          mais. Escolha a categoria de novo.
        </p>
      ) : null}
    </div>
  );
}
