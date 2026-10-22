import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Layers } from "lucide-react";

/** Valores-sentinela do seletor: não são categorias, são as duas portas. */
export const ESCOLHA_CRIAR_CATEGORIA = "NEW_CATEGORY";
export const ESCOLHA_GERENCIAR_CATEGORIAS = "MANAGE_CATEGORIES";

/**
 * PONTO DE INTEGRAÇÃO DA CATEGORIA no formulário de produto.
 *
 * É o campo "Setor / Categoria" de sempre (um `Select` com as categorias da
 * loja e duas portas: criar e gerenciar), isolado num componente para o
 * seletor novo (galeria de ícones) entrar AQUI sem mexer no resto do
 * formulário. Contrato que o substituto deve manter:
 *  - `id="product-category"` no controle que recebe o foco (o formulário e os
 *    testes encontram o campo por ele);
 *  - `valor` é o NOME da categoria ("" = nenhuma); `aoEscolher(nome)` devolve
 *    o nome;
 *  - `aoCriar` / `aoGerenciar` abrem as folhas que o formulário já controla;
 *  - `categoriaDoRascunhoQueSumiu` mostra o recado de rascunho com categoria
 *    apagada (só enquanto `valor === ""`).
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
  readonly nomes: ReadonlyArray<{ readonly id: string; readonly nome: string }>;
  readonly aoEscolher: (nome: string) => void;
  readonly aoCriar: () => void;
  readonly aoGerenciar: () => void;
  readonly categoriaDoRascunhoQueSumiu: string | null;
}) {
  return (
    <div className="produto-campo col-span-2 space-y-1">
      <label
        htmlFor="product-category"
        className="ml-1 block text-[11px] text-zinc-400"
      >
        Setor / Categoria *
      </label>
      <div className="group relative">
        <Select
          name="category"
          value={valor || ""}
          onValueChange={(escolhido) => {
            if (escolhido === ESCOLHA_CRIAR_CATEGORIA) {
              aoCriar();
            } else if (escolhido === ESCOLHA_GERENCIAR_CATEGORIAS) {
              aoGerenciar();
            } else {
              aoEscolher(escolhido);
            }
          }}
        >
          <SelectTrigger
            id="product-category"
            className="h-auto min-h-11 w-full rounded-xl border border-admin-border bg-zinc-950/50 px-4 py-3 text-sm font-black text-white transition-all hover:border-admin-border-strong hover:bg-zinc-900/50 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-2xl sm:px-6 sm:py-5 [&>svg]:opacity-50"
          >
            <SelectValue placeholder="Selecionar Setor" />
          </SelectTrigger>
          <SelectContent className="rounded-xl border-admin-border bg-zinc-900/95 p-2 shadow-[0_10px_40px_rgba(0,0,0,0.8)] backdrop-blur-xl">
            {nomes.map((categoria) => (
              <SelectItem
                key={categoria.id}
                value={categoria.nome}
                className="cursor-pointer rounded-lg px-4 py-3 font-bold text-zinc-300 focus:bg-white/5 focus:text-emerald-400"
              >
                {categoria.nome}
              </SelectItem>
            ))}
            <div className="mx-1 my-2 h-px bg-white/10" />
            <SelectItem
              value={ESCOLHA_CRIAR_CATEGORIA}
              className="cursor-pointer rounded-lg px-4 py-3 font-black text-emerald-500 focus:bg-emerald-500/10 focus:text-emerald-400"
            >
              <span className="flex items-center gap-2">
                ➕ Criar nova categoria
              </span>
            </SelectItem>
            <SelectItem
              value={ESCOLHA_GERENCIAR_CATEGORIAS}
              className="cursor-pointer rounded-lg px-4 py-3 font-black text-zinc-300 focus:bg-white/5 focus:text-white"
            >
              <span className="flex items-center gap-2">
                ✏️ Renomear, esconder ou apagar
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
        <div className="pointer-events-none absolute right-12 top-1/2 -translate-y-1/2 text-zinc-600 transition-colors group-hover:text-emerald-500">
          <Layers className="size-5" />
        </div>
      </div>
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
