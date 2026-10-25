import { QuadradinhoDoIcone } from "@/components/checkout/CartoesDeResumo";
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
import {
  ChevronDown,
  RotateCw,
  Sparkles,
  Tag,
  Ticket,
  Trophy,
} from "lucide-react";
import { memo, useEffect, useId, useRef, useState } from "react";

/**
 * Seção "Cupons" do checkout (frente B, 28/09/2026). Substitui o bloco
 * "Vantagem Exclusiva" que só tinha o campo de digitar: agora a cliente VÊ
 * os cupons que pode usar — os da vitrine da loja e os exclusivos DELA —, em
 * cartões com o desconto em destaque, a validade, o melhor em destaque e
 * "faltam R$ X" quando o carrinho ainda não chega no mínimo. O campo de
 * digitar continua (cupom secreto só entra por ele).
 *
 * PASSO A3 do redesenho (22/10/2026): o cartão INTEIRO é o botão de aplicar
 * (um toque), o cupom escolhido vira o cartão selecionado (borda forte +
 * bolinha escura com check) e o campo de digitar fica atrás do link "Tenho um
 * código de cupom" — as mesmas chamadas e a mesma validação de antes. Paleta
 * neutra: o desconto é verde e "vence hoje/amanhã" é âmbar SÓ no texto.
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

/** O "canhoto" do cartão: o número grande do desconto, em cinza neutro. */
function CanhotoDoCupom({ cupom }: { readonly cupom: CupomDisponivel }) {
  return (
    <span
      aria-hidden="true"
      className="flex min-h-16 min-w-16 shrink-0 flex-col items-center justify-center rounded-xl bg-zinc-100 p-2 text-center text-zinc-900"
    >
      <span className="text-base font-black leading-none tracking-tight">
        {destaqueDoCupom(cupom)}
      </span>
      <span className="mt-1 text-[11px] font-bold uppercase tracking-widest text-zinc-600">
        OFF
      </span>
    </span>
  );
}

const CartaoDeCupom = memo(function CartaoDeCupom({
  cupom,
  melhor,
  aplicandoEste,
  travado,
  onAplicar,
}: CartaoDeCupomProps) {
  const idDaDescricao = useId();
  const validade = validadeDoCupom(cupom.validoAte);
  const vencePerto = validade === "Vence hoje" || validade === "Vence amanhã";
  const progresso = progressoAteOMinimo(cupom);

  const textos = (
    <span className="min-w-0 flex-1 space-y-1">
      {(melhor || cupom.exclusivo) && (
        <span className="flex flex-wrap gap-1.5">
          {melhor && (
            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-bold text-zinc-700">
              <Trophy aria-hidden="true" className="size-3" />
              Melhor opção
            </span>
          )}
          {cupom.exclusivo && (
            <span className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-bold text-zinc-700">
              <Sparkles aria-hidden="true" className="size-3" />
              Exclusivo para você
            </span>
          )}
        </span>
      )}

      <span
        id={idDaDescricao}
        className="block text-sm font-bold leading-snug text-zinc-900"
      >
        {descricaoDoCupom(cupom)}
      </span>
      <span className="block text-xs text-zinc-600">
        <span className="break-all font-mono font-semibold tracking-wide text-zinc-800">
          {cupom.codigo}
        </span>
        {validade && (
          <>
            {" · "}
            <span className={cn(vencePerto && "font-semibold text-amber-800")}>
              {validade}
            </span>
          </>
        )}
      </span>

      {cupom.aplica ? (
        <span className="block text-xs font-semibold text-emerald-700">
          Você economiza {emReais(cupom.desconto)}
        </span>
      ) : (
        <span className="block space-y-1">
          <span className="block text-xs font-semibold text-zinc-700">
            Faltam {emReais(cupom.falta)} em produtos para usar
          </span>
          <span
            role="progressbar"
            aria-label={`Progresso até o mínimo do cupom ${cupom.codigo}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progresso}
            className="block h-1.5 overflow-hidden rounded-full bg-zinc-100"
          >
            <span
              className="block h-full rounded-full bg-zinc-500"
              style={{ width: `${progresso}%` }}
            />
          </span>
        </span>
      )}
    </span>
  );

  // Mínimo não atingido: não é tocável — só informa quanto falta.
  if (!cupom.aplica) {
    return (
      <li className="flex items-center gap-3 rounded-2xl border-2 border-zinc-200 bg-white p-3">
        <CanhotoDoCupom cupom={cupom} />
        {textos}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => onAplicar(cupom.codigo)}
        disabled={travado}
        aria-label={`Aplicar o cupom ${cupom.codigo}`}
        aria-describedby={idDaDescricao}
        className="flex min-h-11 w-full items-center gap-3 rounded-2xl border-2 border-solid border-zinc-200 bg-white p-3 text-left transition-colors hover:border-zinc-300 disabled:cursor-not-allowed"
      >
        <CanhotoDoCupom cupom={cupom} />
        {textos}
        {aplicandoEste ? (
          <span className="shrink-0 text-xs font-semibold text-zinc-700">
            Aplicando…
          </span>
        ) : (
          <span
            data-testid="bolinha-vazia"
            aria-hidden="true"
            className="size-6 shrink-0 rounded-full border-2 border-zinc-500"
          />
        )}
      </button>
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
  /** O pedido está sendo enviado: o desconto já foi para o servidor, então
   *  aplicar ou tirar cupom agora só mudaria a tela. Trava os dois. */
  readonly emEnvio?: boolean;
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
  emEnvio = false,
  onApply,
  onRemove,
}: CuponsDoCheckoutProps) {
  const [verTodos, setVerTodos] = useState(false);
  // "Tenho um código de cupom": o campo de digitar fica atrás do link. Uma
  // recusa do código abre o campo sozinho — o erro nunca fica escondido — mas
  // o link sempre FECHA o campo: tocar nele dispensa o erro que está na tela
  // (`erroDispensado`), sem precisar limpar o estado do pai. Quando o erro
  // some (nova tentativa) a dispensa é esquecida, e o próximo erro reabre.
  const [campoAberto, setCampoAberto] = useState(false);
  const [erroDispensado, setErroDispensado] = useState("");
  const erroPendente = Boolean(couponError) && couponError !== erroDispensado;
  const campoVisivel = campoAberto || erroPendente;
  const focarOCampoRef = useRef(false);
  useEffect(() => {
    if (focarOCampoRef.current && campoAberto)
      document.getElementById("coupon-code-input")?.focus();
    focarOCampoRef.current = false;
  }, [campoAberto]);
  useEffect(() => {
    if (!couponError) setErroDispensado("");
  }, [couponError]);

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

  // O cupom aplicado que a lista conhece mostra o número grande no cartão
  // selecionado; um código secreto (fora da lista) mostra só o ícone.
  const cupomAplicadoDaLista = codigoAplicado
    ? cupons.find((c) => c.codigo.toUpperCase() === codigoAplicado)
    : undefined;

  return (
    <section
      aria-labelledby="titulo-cupons"
      className="rounded-2xl border border-zinc-100/80 bg-white p-4 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <QuadradinhoDoIcone>
          <Tag className="size-4" />
        </QuadradinhoDoIcone>
        <h2
          id="titulo-cupons"
          className="text-base font-semibold text-zinc-900"
        >
          Cupons
        </h2>
      </div>

      <div className="mt-3 space-y-3">
        {appliedCoupon && (
          <CouponInput
            onApply={onApply}
            onRemove={onRemove}
            appliedCoupon={appliedCoupon}
            travado={emEnvio}
            destaque={
              cupomAplicadoDaLista
                ? destaqueDoCupom(cupomAplicadoDaLista)
                : undefined
            }
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
                className="h-[92px] animate-pulse rounded-2xl bg-zinc-100"
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
            <p className="text-sm font-medium text-zinc-600">
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
                  travado={aplicando !== null || emEnvio}
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
          <div>
            <button
              type="button"
              aria-expanded={campoVisivel}
              aria-controls="campo-de-cupom"
              onClick={() => {
                if (campoVisivel) {
                  setCampoAberto(false);
                  setErroDispensado(couponError);
                  return;
                }
                focarOCampoRef.current = true;
                setCampoAberto(true);
              }}
              className="flex min-h-11 w-full items-center gap-2 rounded-xl text-left text-sm font-semibold text-zinc-800"
            >
              <Ticket
                aria-hidden="true"
                className="size-4 shrink-0 text-zinc-600"
              />
              <span className="flex-1">Tenho um código de cupom</span>
              <ChevronDown
                aria-hidden="true"
                className={cn(
                  "size-4 shrink-0 text-zinc-500 transition-transform",
                  campoVisivel && "rotate-180",
                )}
              />
            </button>
            {/* Sempre montado (o que se digita não se perde ao recolher); só
                escondido. */}
            <div id="campo-de-cupom" hidden={!campoVisivel} className="pt-1">
              <CouponInput
                onApply={onApply}
                onRemove={onRemove}
                appliedCoupon={null}
                error={couponError}
                aplicando={aplicando !== null}
                travado={emEnvio}
              />
            </div>
          </div>
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
