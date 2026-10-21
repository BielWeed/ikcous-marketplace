import { LazyImage } from "@/components/LazyImage";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { textoEstoqueBaixo } from "@/lib/texto-estoque-baixo";
import { cn, formatCurrency } from "@/lib/utils";
import type { Product } from "@/types";
import {
  type EixoDaVariacao,
  type ModeloDeEixos,
  disponibilidadeDoValor,
  eixoEhCor,
} from "@/utils/eixos-da-variacao";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ImageIcon,
  Loader2,
  ShoppingCart,
} from "lucide-react";
import { QuantitySelector } from "./QuantitySelector";

const cores = new Map([
  ["azul", "#2563EB"],
  ["verde", "#16A34A"],
  ["preto", "#18181B"],
  ["branco", "#FFFFFF"],
  ["vermelho", "#DC2626"],
  ["rosa", "#F472B6"],
  ["cinza", "#9CA3AF"],
  ["bege", "#E7D8BB"],
  ["marrom", "#92400E"],
  ["amarelo", "#FACC15"],
  ["roxo", "#7C3AED"],
  ["laranja", "#F97316"],
]);

function BolinhaDaCor({
  eixo,
  valor,
}: { eixo: EixoDaVariacao; valor?: string }) {
  const cor = eixoEhCor(eixo)
    ? cores.get(valor?.toLocaleLowerCase() ?? "")
    : undefined;
  return cor ? (
    <span
      aria-hidden="true"
      className="size-4 shrink-0 rounded-full border border-black/15"
      style={{ backgroundColor: cor }}
    />
  ) : null;
}

interface FolhaDeOpcoesProps {
  id: string;
  product: Product;
  modelo: ModeloDeEixos;
  escolhas: Map<string, string>;
  eixoAberto: string | null;
  aviso: { chave: string; texto: string } | null;
  imagem: string;
  preco: number;
  estoque: number;
  quantidade: number;
  indisponivel: boolean;
  cartStatus: "idle" | "loading" | "success";
  avisoDeAdicionado: string;
  onAbrirEixo: (chave: string | null) => void;
  onEscolher: (chave: string, valor: string) => void;
  onQuantidade: (quantidade: number) => void;
  onAdicionar: () => void;
  onDetalhes: () => void;
}

export function focarEscolhaDaFolha(id: string, eixo: string | null) {
  const raiz = document.getElementById(id);
  const painel =
    eixo === null ? null : document.getElementById(`${id}-${eixo}`);
  (
    painel?.querySelector<HTMLButtonElement>("button:not(:disabled)") ??
    raiz?.querySelector<HTMLButtonElement>(
      '[data-testid="product-card-options-add"]',
    )
  )?.focus();
}

// Corpo estático: o estado e a entrega ao carrinho ficam no ProductCard.
export function FolhaDeOpcoes({
  id,
  product,
  modelo,
  escolhas,
  eixoAberto,
  aviso,
  imagem,
  preco,
  estoque,
  quantidade,
  indisponivel,
  cartStatus,
  avisoDeAdicionado,
  onAbrirEixo,
  onEscolher,
  onQuantidade,
  onAdicionar,
  onDetalhes,
}: FolhaDeOpcoesProps) {
  const pendente = modelo.eixos.find((e) => !escolhas.has(e.chave));
  const oferta = !!product.originalPrice && product.originalPrice > preco;
  const desconto = oferta
    ? Math.round((1 - preco / product.originalPrice!) * 100)
    : 0;

  return (
    <div
      id={id}
      className="flex min-h-0 flex-col gap-3 px-4 pb-[calc(12px+var(--folha-folga-segura))] pt-3 text-zinc-900"
    >
      <SheetDescription className="sr-only">
        Escolha as opções para adicionar ao carrinho.
      </SheetDescription>
      <div className="relative flex shrink-0 gap-3">
        <div
          data-testid="product-card-options-thumbnail"
          className="flex size-[72px] shrink-0 items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-100 p-[5px]"
        >
          {imagem ? (
            <LazyImage
              src={imagem}
              alt={product.name}
              priority
              sizes="60px"
              objectFit="contain"
              className="size-[60px] rounded-xl"
            />
          ) : (
            <ImageIcon aria-hidden="true" className="size-6 text-zinc-500" />
          )}
        </div>
        <div className="flex min-h-[72px] min-w-0 flex-1 flex-col justify-center gap-1">
          <SheetTitle className="max-h-[60px] overflow-hidden break-words text-[15px] font-semibold leading-5 text-zinc-900">
            {product.name}
          </SheetTitle>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span
              className={cn(
                "text-lg font-bold leading-6",
                oferta && "text-emerald-700",
              )}
            >
              {formatCurrency(preco)}
            </span>
            {oferta && (
              <>
                <span className="text-[13px] text-zinc-500 line-through">
                  <span className="sr-only">De: </span>
                  {formatCurrency(product.originalPrice!)}
                </span>
                <span className="rounded bg-emerald-50 px-1 text-[11px] font-bold text-emerald-700">
                  -{desconto}%
                </span>
              </>
            )}
          </div>
          <span
            className={cn(
              "pr-24 text-xs font-medium leading-4",
              estoque <= 0
                ? "text-zinc-500"
                : estoque <= 5
                  ? "text-rose-600"
                  : "text-emerald-700",
            )}
          >
            <span aria-hidden="true">• </span>
            {estoque <= 0
              ? "Esgotado"
              : estoque <= 5
                ? textoEstoqueBaixo(estoque)
                : `Estoque: ${estoque}`}
          </span>
        </div>
        <button
          type="button"
          onClick={onDetalhes}
          className="absolute -bottom-2 right-0 flex min-h-11 items-center gap-0.5 rounded px-1 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-zinc-900"
        >
          Ver detalhes <ChevronRight aria-hidden="true" className="size-3.5" />
        </button>
      </div>

      <div
        data-testid="product-card-options-scroll"
        className="min-h-0 overflow-y-auto overscroll-contain rounded-2xl border border-zinc-200"
      >
        {indisponivel ? (
          <p className="bg-zinc-50 px-3 py-4 text-center text-xs text-zinc-700">
            Sem opções disponíveis no momento.
          </p>
        ) : (
          modelo.eixos.map((eixo, indice) => {
            const aberto = eixoAberto === eixo.chave;
            const escolhido = escolhas.get(eixo.chave);
            const painelId = `${id}-${eixo.chave}`;
            // Cor pode ser trocada mesmo invalidando tamanho. Nos demais
            // eixos, cada opção respeita TODAS as outras escolhas, não a
            // posição do eixo na string cadastrada.
            const contextoDeEscolha = eixoEhCor(eixo)
              ? new Map<string, string>()
              : escolhas;
            const valores = eixo.valores.map((valor) => ({
              valor,
              ...disponibilidadeDoValor(
                modelo,
                contextoDeEscolha,
                eixo.chave,
                valor,
              ),
              ultima: disponibilidadeDoValor(
                modelo,
                escolhas,
                eixo.chave,
                valor,
              ).ultima,
            }));
            const contexto = modelo.eixos
              .filter((e) => e.grupo === eixo.grupo && e.chave !== eixo.chave)
              .flatMap((e) => escolhas.get(e.chave) ?? [])
              .join(" / ");
            const avisoDoEixo =
              aviso?.chave === eixo.chave
                ? aviso.texto
                : valores.some((v) => !v.disponivel) && contexto
                  ? `Riscado = esgotado em ${contexto}.`
                  : "";
            return (
              <div
                key={eixo.chave}
                className={cn(
                  indice > 0 && "border-t border-zinc-100",
                  aberto && "bg-zinc-50",
                )}
              >
                <button
                  type="button"
                  aria-expanded={aberto}
                  aria-controls={painelId}
                  aria-label={
                    escolhido === undefined
                      ? `${eixo.nome}: falta escolher`
                      : `${eixo.nome}: ${escolhido}. Toque para trocar`
                  }
                  onClick={() => onAbrirEixo(aberto ? null : eixo.chave)}
                  className="flex min-h-12 w-full items-center gap-2 px-3 text-left text-sm focus-visible:outline-2 focus-visible:outline-zinc-900"
                >
                  <span className="min-w-0 flex-1 break-words text-zinc-600">
                    {eixo.nome}
                  </span>
                  <BolinhaDaCor eixo={eixo} valor={escolhido} />
                  {escolhido === undefined ? (
                    <span className="rounded-full border border-zinc-900 px-2 py-1 text-xs font-semibold">
                      Escolher
                    </span>
                  ) : (
                    <span className="break-words font-semibold">
                      {escolhido}
                    </span>
                  )}
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "size-4 shrink-0 text-zinc-500 transition-transform [transition-duration:180ms] motion-reduce:transition-none",
                      aberto && "rotate-180",
                    )}
                  />
                </button>
                <div
                  id={painelId}
                  aria-hidden={!aberto}
                  inert={!aberto}
                  className={cn(
                    "grid transition-[grid-template-rows] [transition-duration:180ms] motion-reduce:transition-none",
                    aberto ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                  )}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="flex flex-wrap gap-2 px-3 pb-3">
                      {valores.map(({ valor, disponivel, ultima }) => (
                        <button
                          key={valor}
                          type="button"
                          aria-label={valor}
                          disabled={!disponivel}
                          aria-pressed={escolhido === valor}
                          title={
                            !disponivel ? `${valor} — sem estoque` : undefined
                          }
                          onClick={() => onEscolher(eixo.chave, valor)}
                          className={cn(
                            "flex min-h-11 min-w-11 items-center justify-center gap-2 border px-2 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-zinc-900 min-[360px]:min-w-[52px]",
                            eixoEhCor(eixo) ? "rounded-full" : "rounded-xl",
                            escolhido === valor
                              ? "border-zinc-900 bg-zinc-900 text-white"
                              : "border-zinc-200 bg-white text-zinc-900",
                            !disponivel &&
                              "cursor-not-allowed border-dashed text-zinc-500 line-through",
                          )}
                        >
                          <BolinhaDaCor eixo={eixo} valor={valor} />
                          {valor}
                          {ultima && (
                            <span
                              aria-hidden="true"
                              className={
                                escolhido === valor
                                  ? "text-white"
                                  : "text-rose-700"
                              }
                            >
                              · última
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                    {avisoDoEixo && (
                      <p
                        role="status"
                        className="px-3 pb-3 text-xs leading-4 text-zinc-700"
                      >
                        {avisoDoEixo}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="shrink-0">
        <div className="flex items-center gap-2.5">
          {!indisponivel && (
            <QuantitySelector
              quantity={quantidade}
              maxQuantity={Math.max(estoque, 1)}
              onChange={onQuantidade}
              size="folha"
            />
          )}
          <button
            type="button"
            data-testid="product-card-options-add"
            onClick={onAdicionar}
            aria-disabled={
              cartStatus !== "idle" || indisponivel ? true : undefined
            }
            className={cn(
              "flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-[14px] px-3 text-sm font-bold leading-4 text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900",
              cartStatus === "success"
                ? "bg-emerald-700"
                : indisponivel
                  ? "bg-zinc-200 text-zinc-600"
                  : "bg-zinc-900",
            )}
          >
            {cartStatus === "loading" ? (
              <Loader2
                aria-hidden="true"
                className="size-4 shrink-0 animate-spin motion-reduce:animate-none"
              />
            ) : cartStatus === "success" ? (
              <Check aria-hidden="true" className="size-4 shrink-0" />
            ) : !pendente && !indisponivel ? (
              <ShoppingCart
                aria-hidden="true"
                className="hidden size-4 shrink-0 min-[390px]:block"
              />
            ) : null}
            <span>
              {cartStatus === "loading" ? (
                "Salvando..."
              ) : cartStatus === "success" ? (
                "Salvo!"
              ) : indisponivel ? (
                "Indisponível"
              ) : pendente ? (
                <>
                  Escolha:{" "}
                  <span className="block min-[360px]:inline">
                    {pendente.nome}
                  </span>
                </>
              ) : (
                <>
                  Adicionar<span className="hidden min-[360px]:inline"> ·</span>{" "}
                  <span className="block min-[360px]:inline">
                    {formatCurrency(preco * quantidade)}
                  </span>
                </>
              )}
            </span>
          </button>
        </div>
        {!indisponivel && estoque > 0 && quantidade >= estoque && (
          <p className="pt-3 text-xs leading-4 text-zinc-600">
            Máximo de {estoque} unidades (é o que tem em estoque).
          </p>
        )}
        <span role="status" aria-live="polite" className="sr-only">
          {avisoDeAdicionado}
        </span>
      </div>
    </div>
  );
}
