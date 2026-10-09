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
 * produto" (o "Auto" do modal de uma variante).
 */

/** Uma combinação do passo 2, com o que o lojista digitou para ela. */
export interface LinhaNoPasso2 {
  name: string;
  value: string;
  estoque: string;
  preco: string;
}

interface LinhasDaGradeProps {
  linhas: LinhaNoPasso2[];
  /** Quantas variantes o produto já tem (ativas e desligadas): só informa
   *  que elas não são tocadas. */
  quantasExistentes: number;
  /** O SKU previsto de cada linha, na mesma ordem (vazio = "sem SKU"). */
  skusPrevistos: string[];
  skuBase: string;
  onSkuBase: (valor: string) => void;
  aplicarEstoque: string;
  onAplicarEstoque: (valor: string) => void;
  aplicarPreco: string;
  onAplicarPreco: (valor: string) => void;
  onAplicarParaTodas: () => void;
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
  skusPrevistos,
  skuBase,
  onSkuBase,
  aplicarEstoque,
  onAplicarEstoque,
  aplicarPreco,
  onAplicarPreco,
  onAplicarParaTodas,
  onMudarLinha,
}: LinhasDaGradeProps) {
  return (
    <>
      <div className="space-y-2 rounded-2xl border border-dashed border-amber-500/30 bg-amber-500/5 p-4">
        <span className="ml-1 block text-[10px] font-black uppercase tracking-widest text-amber-400">
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
              placeholder="preço"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={onAplicarParaTodas}
          className="w-full rounded-2xl border border-white/10 bg-zinc-950/60 px-5 py-3 text-[10px] font-black uppercase tracking-widest text-emerald-500 transition-all hover:border-emerald-500/30 active:scale-95"
        >
          Aplicar para todas
        </button>
        <p className="ml-1 text-[10px] leading-tight text-zinc-500">
          Deixa o preço vazio para todas usarem o preço padrão do produto — o
          mesmo "Auto" do modal de uma variante.
        </p>
      </div>

      <div className="space-y-2">
        <label
          htmlFor="grade-sku-base"
          className="ml-1 text-[10px] font-black uppercase tracking-widest text-zinc-500"
        >
          SKU base (o sufixo por valor é automático)
        </label>
        <LocalBufferedInput
          id="grade-sku-base"
          name="grade-sku-base"
          type="text"
          value={skuBase}
          onFlush={onSkuBase}
          className="w-full rounded-2xl border border-white/5 bg-zinc-950 px-5 py-4 font-mono text-sm font-bold uppercase transition-all focus:border-emerald-500/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          placeholder="Ex: BLU — vazio nasce sem SKU"
        />
      </div>

      <p
        className="ml-1 text-[10px] font-black uppercase tracking-widest text-emerald-500"
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
            className="block font-mono text-[10px] text-zinc-500"
            data-testid="sku-da-linha"
          >
            {skusPrevistos.at(i) || "sem SKU"}
          </span>
        </div>
      ))}
    </>
  );
}
