import { CouponInput } from "@/components/ui/custom/CouponInput";
import type { SituacaoDosCupons } from "@/hooks/useCuponsDoCheckout";
import {
  type CupomDisponivel,
  descricaoDoCupom,
  destaqueDoCupom,
  emReais,
  melhorCupom,
  progressoAteOMinimo,
  validadeDoCupom,
} from "@/lib/cupons-do-checkout";
import { cn } from "@/lib/utils";
import { RotateCw, Sparkles, Tag, Trophy } from "lucide-react";
import { memo, useState } from "react";

/**
 * Seção "Cupons" do checkout (frente B, 28/09/2026). Substitui o bloco
 * "Vantagem Exclusiva" que só tinha o campo de digitar: agora a cliente VÊ
 * os cupons que pode usar — os da vitrine da loja e os exclusivos DELA —, em
 * cartões com o desconto em destaque, a validade, "Aplicar" com um toque, o
 * melhor em destaque e "faltam R$ X" quando o carrinho ainda não chega no
 * mínimo. O campo de digitar continua (cupom secreto só entra por ele).
 *
 * Só esta seção mudou no celular; o resto do checkout ficou igual. A frente
 * do layout de computador só POSICIONA esta seção — não mexe aqui dentro.
 */

const VISIVEIS_DE_INICIO = 3;

interface CartaoDeCupomProps {
  readonly cupom: CupomDisponivel;
  readonly melhor: boolean;
  readonly aplicandoEste: boolean;
  readonly travado: boolean;
  readonly onAplicar: (codigo: string) => void;
}

const CartaoDeCupom = memo(function CartaoDeCupom({
  cupom,
  melhor,
  aplicandoEste,
  travado,
  onAplicar,
}: CartaoDeCupomProps) {
  const validade = validadeDoCupom(cupom.validoAte);
  const vencePerto = validade === "Vence hoje" || validade === "Vence amanhã";
  const progresso = progressoAteOMinimo(cupom);

  return (
    <li
      className={cn(
        "flex overflow-hidden rounded-xl border bg-white",
        melhor
          ? "border-emerald-500 ring-1 ring-emerald-500"
          : "border-zinc-200",
      )}
    >
      {/* Canhoto do "ticket": o número grande do desconto. */}
      <div
        aria-hidden="true"
        className={cn(
          "flex w-[84px] shrink-0 flex-col items-center justify-center border-r-2 border-dashed px-2 py-3 text-center",
          cupom.aplica
            ? "border-white/40 bg-zinc-900 text-white"
            : "border-zinc-300 bg-zinc-100 text-zinc-700",
          melhor && "bg-emerald-700",
        )}
      >
        <span className="text-lg font-black leading-none tracking-tight">
          {destaqueDoCupom(cupom)}
        </span>
        <span className="mt-1 text-[10px] font-bold uppercase tracking-widest">
          OFF
        </span>
      </div>

      <div className="min-w-0 flex-1 space-y-1.5 p-3">
        {(melhor || cupom.exclusivo) && (
          <div className="flex flex-wrap gap-1.5">
            {melhor && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                <Trophy aria-hidden="true" className="size-3" />
                Melhor opção
              </span>
            )}
            {cupom.exclusivo && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                <Sparkles aria-hidden="true" className="size-3" />
                Exclusivo para você
              </span>
            )}
          </div>
        )}

        <p className="text-sm font-bold leading-snug text-zinc-900">
          {descricaoDoCupom(cupom)}
        </p>
        <p className="text-xs text-zinc-600">
          <span className="font-mono font-semibold tracking-wide text-zinc-800">
            {cupom.codigo}
          </span>
          {validade && (
            <>
              {" · "}
              <span
                className={cn(vencePerto && "font-semibold text-amber-800")}
              >
                {validade}
              </span>
            </>
          )}
        </p>

        {cupom.aplica ? (
          <div className="flex items-center justify-between gap-2 pt-0.5">
            <p className="text-xs font-semibold text-emerald-800">
              Você economiza {emReais(cupom.desconto)}
            </p>
            <button
              type="button"
              onClick={() => onAplicar(cupom.codigo)}
              disabled={travado}
              aria-label={`Aplicar o cupom ${cupom.codigo}`}
              className="min-h-11 shrink-0 rounded-lg bg-zinc-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-600"
            >
              {aplicandoEste ? "Aplicando…" : "Aplicar"}
            </button>
          </div>
        ) : (
          <div className="space-y-1 pt-0.5">
            <p className="text-xs font-semibold text-zinc-700">
              Faltam {emReais(cupom.falta)} em produtos para usar
            </p>
            <div
              role="progressbar"
              aria-label={`Progresso até o mínimo do cupom ${cupom.codigo}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progresso}
              className="h-1.5 overflow-hidden rounded-full bg-zinc-100"
            >
              <div
                className="h-full rounded-full bg-amber-500"
                style={{ width: `${progresso}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </li>
  );
});

export interface CuponsDoCheckoutProps {
  readonly cupons: readonly CupomDisponivel[];
  readonly situacao: SituacaoDosCupons;
  readonly onTentarDeNovo: () => void;
  readonly appliedCoupon: { code: string; discount: number } | null;
  readonly couponError: string;
  /** Código em validação agora (toque em "Aplicar"), ou null. */
  readonly aplicando: string | null;
  readonly onApply: (code: string) => void;
  readonly onRemove: () => void;
}

export const CuponsDoCheckout = memo(function CuponsDoCheckout({
  cupons,
  situacao,
  onTentarDeNovo,
  appliedCoupon,
  couponError,
  aplicando,
  onApply,
  onRemove,
}: CuponsDoCheckoutProps) {
  const [verTodos, setVerTodos] = useState(false);

  // O aplicado aparece em cima (bloco verde) — não se repete na lista.
  const codigoAplicado = appliedCoupon?.code.toUpperCase() ?? null;
  const outros = cupons.filter(
    (c) => c.codigo.toUpperCase() !== codigoAplicado,
  );
  // "Melhor opção" só quando economiza MAIS que o cupom já aplicado.
  const candidatoAMelhor = melhorCupom(outros);
  const melhor =
    candidatoAMelhor &&
    (!appliedCoupon ||
      (outros.find((c) => c.codigo === candidatoAMelhor)?.desconto ?? 0) >
        appliedCoupon.discount)
      ? candidatoAMelhor
      : null;
  const visiveis = verTodos ? outros : outros.slice(0, VISIVEIS_DE_INICIO);
  const escondidos = outros.length - visiveis.length;

  const carregandoPelaPrimeiraVez =
    situacao === "carregando" && cupons.length === 0;

  return (
    <section
      aria-labelledby="titulo-cupons"
      className="overflow-hidden rounded-2xl border border-zinc-100/80 bg-white shadow-sm"
    >
      <div className="flex items-center gap-2 border-b border-zinc-100/50 bg-zinc-50/40 px-4 py-3">
        <div className="flex size-8 items-center justify-center rounded-xl bg-white text-zinc-900 shadow-sm">
          <Tag className="size-4" />
        </div>
        <h2
          id="titulo-cupons"
          className="text-[11px] font-bold uppercase tracking-wider text-zinc-600"
        >
          Cupons
        </h2>
      </div>

      <div className="space-y-4 p-4">
        {appliedCoupon && (
          <CouponInput
            onApply={onApply}
            onRemove={onRemove}
            appliedCoupon={appliedCoupon}
          />
        )}

        {/* Recusa de um toque em cartão quando JÁ há um cupom aplicado (o
            campo, que mostra o erro, não está na tela nesse caso). */}
        {appliedCoupon && couponError && (
          <p role="alert" className="text-xs font-medium text-red-700">
            {couponError}
          </p>
        )}

        {carregandoPelaPrimeiraVez && (
          <div
            aria-busy="true"
            aria-label="Carregando cupons"
            className="space-y-2"
          >
            {[0, 1].map((i) => (
              <div
                key={i}
                className="h-[92px] animate-pulse rounded-xl bg-zinc-100"
              />
            ))}
          </div>
        )}

        {situacao === "erro" && cupons.length === 0 && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-zinc-50 p-3">
            <p className="text-xs text-zinc-700">
              Não conseguimos carregar os cupons disponíveis.
            </p>
            <button
              type="button"
              onClick={onTentarDeNovo}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-zinc-900 underline underline-offset-2 hover:bg-zinc-100"
            >
              <RotateCw aria-hidden="true" className="size-3.5" />
              Tentar de novo
            </button>
          </div>
        )}

        {outros.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-zinc-700">
              {appliedCoupon
                ? "Outros cupons para você"
                : "Cupons disponíveis para você"}
            </p>
            <ul aria-label="Cupons disponíveis" className="space-y-2">
              {visiveis.map((cupom) => (
                <CartaoDeCupom
                  key={cupom.codigo}
                  cupom={cupom}
                  melhor={cupom.codigo === melhor}
                  aplicandoEste={aplicando === cupom.codigo}
                  travado={aplicando !== null}
                  onAplicar={onApply}
                />
              ))}
            </ul>
            {escondidos > 0 && (
              <button
                type="button"
                onClick={() => setVerTodos(true)}
                className="min-h-11 w-full rounded-lg text-sm font-semibold text-zinc-900 underline underline-offset-2 hover:bg-zinc-50"
              >
                Ver mais {escondidos} {escondidos === 1 ? "cupom" : "cupons"}
              </button>
            )}
          </div>
        )}

        {!appliedCoupon && (
          <CouponInput
            onApply={onApply}
            onRemove={onRemove}
            appliedCoupon={null}
            error={couponError}
            aplicando={aplicando !== null}
          />
        )}

        {/* Anúncio para leitor de tela quando o cupom entra. */}
        <p role="status" className="sr-only">
          {appliedCoupon && appliedCoupon.discount > 0
            ? `Cupom ${appliedCoupon.code} aplicado. Você economiza ${emReais(appliedCoupon.discount)}.`
            : ""}
        </p>
      </div>
    </section>
  );
});
