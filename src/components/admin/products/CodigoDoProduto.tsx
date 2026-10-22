import { LocalBufferedInput } from "@/components/admin/LocalBufferedInput";
import { InterruptorDoProduto } from "@/components/admin/products/InterruptorDoProduto";
import { Layers, RefreshCw } from "lucide-react";

/**
 * O código interno do PRODUTO, em Avançado: ou a lojista digita (campo
 * de sempre, `#product-sku`), ou liga o automático e a loja gera um código
 * (`CAM-7K3F`). O valor mora SEMPRE em `formData.sku` do formulário — este
 * componente só desenha e avisa; o salvar não sabe que existe automático.
 *
 * Desligado o automático, o campo volta com o que a lojista tinha antes.
 */
export function CodigoDoProduto({
  automatico,
  onAlternar,
  codigoGerado,
  onOutro,
  valorManual,
  onManual,
  erro,
  rotuloDoCampo,
}: {
  readonly automatico: boolean;
  readonly onAlternar: () => void;
  /** O código que está valendo enquanto o automático está ligado. */
  readonly codigoGerado: string;
  readonly onOutro: () => void;
  readonly valorManual: string;
  readonly onManual: (valor: string) => void;
  readonly erro: string;
  /** O nome do campo de digitar (o formulário é quem o declara). */
  readonly rotuloDoCampo: string;
}) {
  return (
    <div className="space-y-3">
      <InterruptorDoProduto
        rotulo="Gerar código automático"
        descricao="A loja cria o código. Desligado, você digita o seu."
        ligado={automatico}
        onAlternar={onAlternar}
      />
      {automatico ? (
        <div className="space-y-2">
          <div className="produto-codigo-gerado">
            <span className="min-w-0">
              <span className="produto-codigo-gerado-rotulo">
                Código do produto
              </span>
              <span
                data-testid="codigo-automatico"
                className="produto-codigo-gerado-valor"
              >
                {codigoGerado}
              </span>
            </span>
            <button
              type="button"
              aria-label="Gerar outro código"
              onClick={onOutro}
              className="produto-codigo-gerado-outro"
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              Outro
            </button>
          </div>
          <span className="ml-1 block text-[11px] leading-tight text-zinc-400">
            Começa com as 3 primeiras letras da categoria. Na grade de
            variações, cada combinação já vem com um código que começa por este.
          </span>
        </div>
      ) : (
        <div className="space-y-1.5 md:space-y-3">
          <label
            htmlFor="product-sku"
            className="ml-1 text-[11px] font-black uppercase tracking-widest text-zinc-500"
          >
            {rotuloDoCampo}
          </label>
          <div className="group relative">
            <LocalBufferedInput
              id="product-sku"
              aria-invalid={!!erro}
              aria-describedby={erro ? "product-sku-error" : undefined}
              name="product-sku"
              type="text"
              value={valorManual}
              onFlush={(val) =>
                onManual(val.trim().toUpperCase().replace(/\s+/g, "-"))
              }
              placeholder="Ex: CAMISETA-BASE"
              className="w-full rounded-xl border border-admin-border bg-zinc-950/50 px-4 py-3 text-sm font-black text-white transition-all placeholder:text-zinc-800 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 sm:rounded-2xl sm:px-6 sm:py-5"
            />
            <div className="pointer-events-none absolute right-6 top-1/2 -translate-y-1/2 text-zinc-600">
              <Layers className="size-5" />
            </div>
          </div>
          {erro && (
            <span
              id="product-sku-error"
              className="ml-1 mt-1 block text-[11px] font-bold text-red-500"
            >
              {erro}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
