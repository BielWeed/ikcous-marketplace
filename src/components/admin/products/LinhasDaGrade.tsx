import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";

/**
 * PASSO 2 do modal da grade (`ModalVarianteGrade.tsx`): só as combinações que
 * AINDA NÃO EXISTEM no produto, cada uma com estoque e preço editáveis, mais o
 * "Aplicar para todas" para o 90% do lote e o SKU base. O SKU de cada linha é
 * gerado a partir do SKU base; para trocar um SKU específico, edite a variação
 * depois de criada.
 *
 * É só a tela do passo: o estado (as linhas, o SKU base, o que foi digitado
 * em "aplicar") mora no modal, que é quem efetiva. Preço por combinação é o
 * que existe aqui — sem campo a mais: vazio quer dizer "usa o preço padrão do
 * produto" (o "Auto" do modal de uma variante). Produto sem preço ainda: o
 * preço digitado aqui vira o Preço de Venda dele (`preco-da-grade.ts` decide);
 * produto que já tem preço: ele aparece de sugestão e o que se digita vale só
 * para estas combinações novas.
 */

/** Uma combinação do passo 2, com o que o lojista digitou para ela. */
export interface LinhaNoPasso2 {
  name: string;
  value: string;
  estoque: string;
  preco: string;
  /** A lojista mexeu no estoque desta linha (digitou nela ou usou "Aplicar para
   *  todas"). É o que separa "0 que ela deixou" de "0 que ela digitou": o
   *  estoque segurado só preenche as linhas que ela nunca mexeu. */
  estoqueEditado?: boolean;
}

interface LinhasDaGradeProps {
  linhas: LinhaNoPasso2[];
  /** Quantas variantes o produto já tem (ativas e desligadas): só informa
   *  que elas não são tocadas. */
  quantasExistentes: number;
  /** O Preço de Venda que o produto já tem (maior que zero), ou `undefined`
   *  quando o campo ainda está vazio — muda a sugestão e a frase do bloco. */
  precoDoProduto: number | undefined;
  /** O campo Preço de Venda está VAZIO (a mesma conta de `resolverPrecoDaGrade`).
   *  Sem preço válido e sem estar vazio (ex.: "0,00"), a grade não escreve por
   *  cima e a frase não pode prometer que o preço digitado vira o do produto. */
  produtoSemPreco: boolean;
  /** O SKU previsto de cada linha, na mesma ordem (vazio = "sem SKU"). */
  skusPrevistos: string[];
  skuBase: string;
  onSkuBase: (valor: string) => void;
  aplicarEstoque: string;
  onAplicarEstoque: (valor: string) => void;
  aplicarPreco: string;
  onAplicarPreco: (valor: string) => void;
  onAplicarParaTodas: () => void;
  /** Há valor digitado em "Aplicar para todas" que ainda não foi aplicado e que
   *  vai preencher linhas ao efetivar (`grade-valor-segurado.ts`): mostra a
   *  frase que avisa, para a lojista não achar que ele se perdeu. */
  valorSeguradoPendente: boolean;
  /** Troca o estoque ou o preço de UMA linha (índice na ordem da grade). */
  onMudarLinha: (
    indice: number,
    campo: "estoque" | "preco",
    valor: string,
  ) => void;
}

export function LinhasDaGrade({
  linhas,
  quantasExistentes,
  precoDoProduto,
  produtoSemPreco,
  skusPrevistos,
  skuBase,
  onSkuBase,
  aplicarEstoque,
  onAplicarEstoque,
  aplicarPreco,
  onAplicarPreco,
  onAplicarParaTodas,
  valorSeguradoPendente,
  onMudarLinha,
}: LinhasDaGradeProps) {
  const precoDoProdutoEmReais =
    precoDoProduto === undefined
      ? null
      : precoDoProduto.toLocaleString("pt-BR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
  return (
    <>
      <div className="space-y-2 rounded-2xl border border-dashed border-amber-500/30 bg-amber-500/5 p-4">
        <span className="ml-1 block text-[11px] font-black uppercase tracking-wider text-amber-400">
          Aplicar para todas
        </span>
        <div className="grid grid-cols-2 gap-3">
          <LocalBufferedInput
            id="grade-aplicar-estoque"
            name="grade-aplicar-estoque"
            type="number"
            aria-label="Estoque para todas as linhas"
            value={aplicarEstoque}
            onFlush={onAplicarEstoque}
            className="w-full rounded-2xl border border-white/5 bg-zinc-950 px-4 py-3.5 text-sm font-black transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            placeholder="estoque"
          />
          <div className="relative flex items-center">
            <span className="absolute left-4 text-xs font-black text-zinc-600">
              R$
            </span>
            <LocalBufferedInput
              id="grade-aplicar-preco"
              name="grade-aplicar-preco"
              mask="currency"
              aria-label="Preço para todas as linhas"
              value={aplicarPreco}
              onFlush={onAplicarPreco}
              className="w-full rounded-2xl border border-white/5 bg-zinc-950 py-3.5 pl-10 pr-4 text-sm font-black transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
              placeholder={precoDoProdutoEmReais ?? "preço"}
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onAplicarParaTodas}
          className="min-h-11 w-full rounded-2xl border border-white/10 bg-zinc-950/60 px-5 py-3 text-[11px] font-black uppercase tracking-widest text-emerald-500 transition-all hover:border-emerald-500/30 active:scale-95"
        >
          Aplicar para todas
        </button>
        {valorSeguradoPendente && (
          <p
            role="status"
            className="ml-1 text-[11px] font-bold leading-tight text-amber-400"
            data-testid="valor-segurado-aviso"
          >
            Este valor será usado nas linhas que você ainda não preencheu ao
            salvar. Clique em "Aplicar para todas" para colocar em todas as
            linhas.
          </p>
        )}
        {precoDoProdutoEmReais === null && !produtoSemPreco ? (
          <p
            className="ml-1 text-[11px] leading-tight text-zinc-500"
            data-testid="preco-do-produto-na-grade"
          >
            O Preço de Venda do produto ainda não está certo (corrija no
            formulário). O preço digitado aqui vale só para estas combinações
            novas.
          </p>
        ) : precoDoProdutoEmReais === null ? (
          <p
            className="ml-1 text-[11px] leading-tight text-zinc-500"
            data-testid="preco-do-produto-na-grade"
          >
            O produto ainda não tem Preço de Venda: o preço que você digitar
            para todas as linhas vira o dele (se forem diferentes, vale o
            menor). Se só algumas linhas tiverem preço, você ainda informa o
            Preço de Venda no formulário.
          </p>
        ) : (
          <p
            className="ml-1 text-[11px] leading-tight text-zinc-500"
            data-testid="preco-do-produto-na-grade"
          >
            O preço do produto é R$ {precoDoProdutoEmReais}. Deixe o preço vazio
            para a variação usar esse mesmo preço ("Auto"); um valor digitado
            aqui vale só para estas combinações novas e não muda o preço do
            produto.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <label
          htmlFor="grade-sku-base"
          className="ml-1 text-[11px] font-black uppercase tracking-wider text-zinc-500"
        >
          Código interno base (o sufixo por valor é automático)
        </label>
        <LocalBufferedInput
          id="grade-sku-base"
          name="grade-sku-base"
          type="text"
          value={skuBase}
          onFlush={onSkuBase}
          className="w-full rounded-2xl border border-white/5 bg-zinc-950 px-5 py-4 font-mono text-sm font-bold uppercase transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          placeholder="Ex: BLU — vazio nasce sem código"
        />
      </div>

      <p
        className="ml-1 text-[11px] font-black uppercase tracking-wider text-emerald-500"
        data-testid="contador-da-grade"
      >
        Só as {linhas.length} novas — as {quantasExistentes} existentes não são
        tocadas
      </p>

      {linhas.map((linha, i) => (
        <div
          key={JSON.stringify([linha.name, linha.value])}
          className="space-y-2 rounded-2xl border border-white/5 bg-zinc-950/60 p-4"
        >
          <span
            className="block text-sm font-black uppercase italic tracking-tight text-white"
            data-testid="linha-da-grade"
          >
            {linha.value}
          </span>
          <div className="grid grid-cols-2 gap-3">
            <LocalBufferedInput
              id={`grade-linha-estoque-${i}`}
              name={`grade-linha-estoque-${i}`}
              type="number"
              aria-label={`Estoque de ${linha.value}`}
              value={linha.estoque}
              onFlush={(val) => onMudarLinha(i, "estoque", val)}
              className="w-full rounded-2xl border border-white/5 bg-zinc-950 px-4 py-3 text-sm font-black transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
            <div className="relative flex items-center">
              <span className="absolute left-4 text-xs font-black text-zinc-600">
                R$
              </span>
              <LocalBufferedInput
                id={`grade-linha-preco-${i}`}
                name={`grade-linha-preco-${i}`}
                mask="currency"
                aria-label={`Preço de ${linha.value}`}
                value={linha.preco}
                onFlush={(val) => onMudarLinha(i, "preco", val)}
                className="w-full rounded-2xl border border-white/5 bg-zinc-950 py-3 pl-10 pr-4 text-sm font-black transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
                placeholder="Auto"
              />
            </div>
          </div>
          <span
            className="block font-mono text-[11px] text-zinc-500"
            data-testid="sku-da-linha"
          >
            {skusPrevistos.at(i) || "sem código"}
          </span>
        </div>
      ))}
    </>
  );
}
