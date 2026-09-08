import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  type LinhaEstornoDoPedido,
  useEstornosDoPedido,
} from "@/hooks/useEstornosDoPedido";
import { formatCurrency } from "@/lib/utils";
import type { Order } from "@/types";

interface EstornoCardProps {
  order: Order;
}

const VALOR_MINIMO = 0.01;

// ANOTADO do laudo 08/09: "1.500,00" (pt-BR com separador de milhar) virava
// NaN — `Number("1.500,00".replace(",", "."))` = `Number("1.500.00")`. Regra:
// só remove os pontos de milhar e troca a vírgula por ponto quando o texto
// CASA o padrão pt-BR completo; fora disso, mantém o comportamento simples
// (vírgula única -> ponto), o que já aceitava "1500,50" e "1500.50". Texto
// com letra ("1e2") ou qualquer outro formato cai em `NaN` — o campo é
// SEMPRE um valor em reais, nunca notação científica.
// eslint-disable-next-line security/detect-unsafe-regex -- medido linear (<2 ms em 200 mil chars, laudo Opus 08/09 rodada 2): \d{3} de tamanho fixo dentro de (...)* não é ambíguo
const RE_VALOR_MILHAR_PT_BR = /^\d{1,3}(\.\d{3})*(,\d{1,2})?$/;
// eslint-disable-next-line security/detect-unsafe-regex -- medido linear (<2 ms em 200 mil chars, laudo Opus 08/09 rodada 2): \d{3} de tamanho fixo dentro de (...)* não é ambíguo
const RE_VALOR_SIMPLES = /^\d+([.,]\d+)?$/;

function paraNumero(valorBruto: string): number {
  const texto = valorBruto.trim();
  if (RE_VALOR_MILHAR_PT_BR.test(texto)) {
    return Number(texto.replace(/\./g, "").replace(",", "."));
  }
  if (RE_VALOR_SIMPLES.test(texto)) {
    return Number(texto.replace(",", "."));
  }
  return Number.NaN;
}

function formatarDataHora(iso: string): string {
  const data = new Date(iso);
  const dataFormatada = data.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
  });
  const horaFormatada = data.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${dataFormatada} às ${horaFormatada}`;
}

interface TextoDaLinha {
  texto: string;
  /** Só `falhou` oferece nova tentativa — as demais (em andamento, teto,
   * chargeback, concluído, recusado) não têm ação nenhuma na linha. */
  podeTentarDeNovo: boolean;
}

/**
 * Texto de UMA linha de `order_refunds`, seguindo a máquina de estados do
 * plano-mãe de estorno. Nunca expõe `mp_refund_id`, id do Mercado Pago,
 * "PAY", "api." ou caminho — regra global do plano + M4 do laudo #436
 * (dinheiro sempre formatado com `formatCurrency`, nunca cru).
 */
function textoDaLinha(linha: LinhaEstornoDoPedido): TextoDaLinha {
  const valor = formatCurrency(linha.amount);
  const quando = formatarDataHora(linha.concluido_em ?? linha.created_at);

  if (linha.mp_status === "charged_back") {
    if (linha.status === "em_processamento") {
      return {
        texto: `Contestação (chargeback) de ${valor} em análise no Mercado Pago — o valor fica reservado até a decisão.`,
        podeTentarDeNovo: false,
      };
    }
    if (linha.status === "concluido") {
      return {
        texto: `Contestação (chargeback) de ${valor} decidida contra a loja em ${quando}: o dinheiro voltou ao cliente.`,
        podeTentarDeNovo: false,
      };
    }
    if (linha.status === "recusado") {
      return {
        texto: `Contestação de ${valor} decidida a favor da loja: o dinheiro ficou com você.`,
        podeTentarDeNovo: false,
      };
    }
  }

  // Teto de tentativas (pré-requisito 2 do plano): a linha fica travada em
  // `em_processamento` para sempre em vez de arriscar pagar duas vezes. A
  // saída manual do limbo exigiria RPC nova = migration = decisão do dono;
  // por isso NÃO existe botão "Tentar de novo" aqui, só o aviso.
  if (linha.status === "em_processamento" && linha.tentativas >= 5) {
    return {
      texto: `A devolução de ${valor} não foi confirmada pelo Mercado Pago depois de 5 tentativas. Confira no painel do Mercado Pago se ela saiu; o valor fica reservado aqui até isso se resolver.`,
      podeTentarDeNovo: false,
    };
  }

  if (linha.status === "solicitado" || linha.status === "em_processamento") {
    return {
      texto: `Devolução de ${valor} em andamento — o Mercado Pago está processando. Eu aviso aqui quando concluir.`,
      podeTentarDeNovo: false,
    };
  }

  if (linha.status === "concluido") {
    if (linha.solicitado_por === "sistema") {
      return {
        texto: `${valor} devolvido fora do app (pelo painel do Mercado Pago) em ${quando}`,
        podeTentarDeNovo: false,
      };
    }
    return {
      texto: `${valor} devolvido em ${quando}`,
      podeTentarDeNovo: false,
    };
  }

  if (linha.status === "falhou") {
    return {
      texto: `A devolução de ${valor} não foi concluída: ${linha.ultimo_erro ?? ""}`,
      podeTentarDeNovo: true,
    };
  }

  // `recusado`, sem chargeback envolvido.
  return {
    texto: `A devolução de ${valor} foi recusada: ${linha.ultimo_erro ?? ""}`,
    podeTentarDeNovo: false,
  };
}

type EstadoDoCartao =
  | "bloqueado_status"
  | "bloqueado_retorno"
  | "tudo_devolvido"
  | "normal";

// Regra do dono (24/08/2026), a mesma que a RPC `solicitar_estorno` recusa
// no servidor — aqui só EXPLICA antes do clique. Ordem importa: um pedido
// não cancelado nunca chega a precisar do produto de volta.
function estadoDoCartao(order: Order, disponivel: number): EstadoDoCartao {
  if (order.status !== "cancelled") return "bloqueado_status";
  if (order.cancelledAfterShipping && !order.returnedToSellerAt) {
    return "bloqueado_retorno";
  }
  if (disponivel <= 0) return "tudo_devolvido";
  return "normal";
}

export function EstornoCard({ order }: Readonly<EstornoCardProps>) {
  const {
    linhas,
    pago,
    devolvido,
    disponivel,
    carregando,
    pedidoCarregado,
    erro,
    recarregar,
    solicitarEstorno,
    enviando,
  } = useEstornosDoPedido(order.id);

  const [campoAberto, setCampoAberto] = useState(false);
  const [valorCampo, setValorCampo] = useState("");
  const inputValorRef = useRef<HTMLInputElement>(null);

  // Acessibilidade (ANOTADO do laudo 08/09): ao abrir o campo o foco vai
  // para o input — sem isso quem navega por teclado/leitor de tela não
  // percebe que um campo novo apareceu. `autoFocus` é reprovado pelo
  // eslint-plugin-jsx-a11y (`no-autofocus`) mesmo sendo aberto por gesto do
  // próprio lojista — por isso o foco é feito à mão, no efeito.
  useEffect(() => {
    if (campoAberto) inputValorRef.current?.focus();
  }, [campoAberto]);

  if (erro) {
    return (
      <div className="admin-glass space-y-3 rounded-[2rem] border border-red-500/20 p-5 text-white">
        <p className="text-xs font-bold text-red-400">
          Não consegui carregar as devoluções deste pedido.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => recarregar()}
        >
          Tentar carregar de novo
        </Button>
      </div>
    );
  }

  // BLOQUEIA 2 do laudo 08/09: enquanto a primeira leitura do banco não
  // voltou (`pedido === null` no hook), `pago`/`devolvido`/`disponivel`
  // ainda são só os zeros de default — "ainda não sei" é diferente de "o
  // saldo é zero", e afirmar qualquer coisa aqui (inclusive "R$ 0,00") seria
  // mentir para o lojista sobre dinheiro.
  if (!pedidoCarregado) {
    return (
      <div className="admin-glass space-y-4 rounded-[2rem] border border-white/5 p-5 text-white">
        <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
          Devolução de dinheiro
        </h3>
        <p className="text-[10px] font-bold text-zinc-600">Carregando…</p>
      </div>
    );
  }

  const estado = estadoDoCartao(order, disponivel);
  const mostrarBotao = estado !== "tudo_devolvido";
  const podeAbrirCampo = estado === "normal";

  const valorNumericoDoCampo = paraNumero(valorCampo);
  const campoValido =
    !campoAberto ||
    (Number.isFinite(valorNumericoDoCampo) &&
      valorNumericoDoCampo >= VALOR_MINIMO &&
      valorNumericoDoCampo <= disponivel);

  const valorAlvo = campoAberto ? valorNumericoDoCampo : disponivel;
  const valorParaOLabel = campoAberto
    ? Number.isFinite(valorNumericoDoCampo)
      ? valorNumericoDoCampo
      : 0
    : disponivel;

  const botaoDesabilitado =
    estado !== "normal" ? true : enviando || !campoValido;

  async function pedirConfirmacaoEEnviar(amount: number) {
    const confirmado = globalThis.confirm(
      `Devolver ${formatCurrency(amount)} ao cliente pelo Mercado Pago? O dinheiro sai da sua conta do Mercado Pago e não dá para desfazer.`,
    );
    if (!confirmado) return;
    await solicitarEstorno({ amount, motivo: "" });
  }

  return (
    <div className="admin-glass space-y-4 rounded-[2rem] border border-white/5 p-5 text-white">
      <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
        Devolução de dinheiro
      </h3>

      <p className="text-xs font-bold text-zinc-400">
        Pago: {formatCurrency(pago)} · Devolvido: {formatCurrency(devolvido)} ·
        Disponível: {formatCurrency(disponivel)}
      </p>

      {estado === "bloqueado_status" && (
        <p className="text-xs font-bold text-amber-400">
          Cancele o pedido antes de devolver o dinheiro.
        </p>
      )}
      {estado === "bloqueado_retorno" && (
        <p className="text-xs font-bold text-amber-400">
          Para devolver o dinheiro, primeiro confirme que o produto voltou, no
          aviso de pedidos cancelados (ícone ao lado do título Pedidos).
        </p>
      )}
      {estado === "tudo_devolvido" && (
        <p className="text-xs font-bold text-emerald-400">
          Todo o valor pago já foi devolvido.
        </p>
      )}

      {mostrarBotao && (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            disabled={botaoDesabilitado}
            aria-disabled={botaoDesabilitado}
            onClick={() => pedirConfirmacaoEEnviar(valorAlvo)}
          >
            {enviando
              ? "Devolvendo…"
              : `Devolver ${formatCurrency(Math.max(valorParaOLabel, 0))}`}
          </Button>

          {podeAbrirCampo && !campoAberto && (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => setCampoAberto(true)}
            >
              devolver outro valor
            </Button>
          )}

          {podeAbrirCampo && campoAberto && (
            <div className="space-y-1">
              <label
                htmlFor={`valor-outro-estorno-${order.id}`}
                className="text-[8px] font-black uppercase tracking-widest text-zinc-500"
              >
                Valor a devolver
              </label>
              <Input
                id={`valor-outro-estorno-${order.id}`}
                ref={inputValorRef}
                inputMode="decimal"
                value={valorCampo}
                onChange={(e) => setValorCampo(e.target.value)}
                aria-invalid={!campoValido}
                aria-describedby={
                  !campoValido
                    ? `valor-outro-estorno-aviso-${order.id}`
                    : undefined
                }
                className="h-9 w-32 rounded-lg border-white/10 bg-zinc-950 text-xs text-white"
              />
              {!campoValido && (
                <p
                  id={`valor-outro-estorno-aviso-${order.id}`}
                  className="text-[10px] font-bold text-red-400"
                >
                  O valor tem de ficar entre {formatCurrency(VALOR_MINIMO)} e{" "}
                  {formatCurrency(disponivel)}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div aria-live="polite" className="space-y-2">
        {linhas.map((linha) => {
          const { texto, podeTentarDeNovo } = textoDaLinha(linha);
          const podeTentarComSaldo =
            podeTentarDeNovo && disponivel >= linha.amount;
          return (
            <p
              key={linha.id}
              className="text-[11px] font-semibold text-zinc-300"
            >
              {texto}
              {podeTentarComSaldo && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  disabled={enviando}
                  onClick={() => pedirConfirmacaoEEnviar(linha.amount)}
                >
                  Tentar de novo
                </Button>
              )}
            </p>
          );
        })}
      </div>

      {carregando && linhas.length === 0 && (
        <p className="text-[10px] font-bold text-zinc-600">Carregando…</p>
      )}
    </div>
  );
}
