import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useConfirmarAcao } from "@/hooks/useConfirmarAcao";
import {
  type LinhaEstornoDoPedido,
  useEstornosDoPedido,
} from "@/hooks/useEstornosDoPedido";
import { formatarDataHoraBrasilia } from "@/lib/data-da-loja";
import {
  BOTAO_POR_FORA_APOS_ESPERA,
  TEXTO_CONFIRMANDO,
  TEXTO_JA_POR_FORA,
  acoesDaLinha,
  confirmouPorForaAposEspera,
  linhaViva,
  textoReservado,
} from "@/lib/reembolso-em-duvida";
import { formatCurrency } from "@/lib/utils";
import type { Order } from "@/types";

interface EstornoCardProps {
  order: Order;
  /** Sem internet, as ações que falam com o servidor ficam desligadas, como
   * nos outros cartões da ficha (etiqueta, rastreio). */
  isOffline?: boolean;
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
  const quando =
    formatarDataHoraBrasilia(linha.concluido_em, "curto") ||
    formatarDataHoraBrasilia(linha.created_at, "curto");
  const dataDaLinha = quando ? ` em ${quando}` : "";

  if (linha.mp_status === "charged_back") {
    if (linha.status === "em_processamento") {
      return {
        texto: `Contestação no cartão de ${valor} em análise no Mercado Pago — o valor fica reservado até a decisão.`,
        podeTentarDeNovo: false,
      };
    }
    if (linha.status === "concluido") {
      return {
        texto: `Contestação no cartão de ${valor} decidida contra a loja${dataDaLinha}: o dinheiro voltou ao cliente.`,
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
  // `em_processamento` para sempre em vez de arriscar pagar duas vezes. NÃO
  // existe "Tentar de novo" aqui; a única saída é a dos 7 dias (lote R1), que
  // aparece abaixo da linha quando o SERVIDOR a libera.
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
        texto: `${valor} devolvido fora do app (pelo painel do Mercado Pago)${dataDaLinha}`,
        podeTentarDeNovo: false,
      };
    }
    return {
      texto: `${valor} devolvido${dataDaLinha}`,
      podeTentarDeNovo: false,
    };
  }

  // Lote R1: o veredito "pode ter saído" é do SERVIDOR. Linha parada que
  // pode ter chegado ao Mercado Pago NUNCA ganha "Tentar de novo": a
  // tentativa nova vai com chave nova, o MP não deduplica e o cliente
  // receberia em dobro.
  const { podeRepetir, confirmando } = acoesDaLinha(linha);

  if (linha.status === "falhou") {
    if (confirmando) {
      return {
        texto: `A devolução de ${valor} não teve resposta certa do Mercado Pago. ${TEXTO_CONFIRMANDO}`,
        podeTentarDeNovo: false,
      };
    }
    return {
      texto: `A devolução de ${valor} não foi concluída: ${linha.ultimo_erro ?? ""}`,
      podeTentarDeNovo: podeRepetir,
    };
  }

  // `recusado`, sem chargeback envolvido.
  return {
    texto: `A devolução de ${valor} foi recusada: ${linha.ultimo_erro ?? ""}${confirmando ? ` ${TEXTO_CONFIRMANDO}` : ""}`,
    podeTentarDeNovo: false,
  };
}

function avisoDeDevolucoesEmAndamento(linhas: LinhaEstornoDoPedido[]): string {
  const emAndamento = linhas.filter(
    (linha) =>
      linha.mp_status !== "charged_back" &&
      (linhaViva(linha.status) ||
        (linha.status === "concluido" && linha.concluido_em === null) ||
        acoesDaLinha(linha).confirmando),
  );
  if (emAndamento.length === 0) return "";

  const devolucoes = emAndamento.map((linha) => {
    const valor =
      Number.isFinite(linha.amount) && linha.amount >= VALOR_MINIMO
        ? formatCurrency(linha.amount)
        : "";
    const quando = formatarDataHoraBrasilia(linha.created_at, "curto");
    if (emAndamento.length === 1) {
      return `Já existe uma devolução${valor ? ` de ${valor}` : ""} em andamento neste pedido.${quando ? ` Solicitada em ${quando}.` : ""}`;
    }
    if (!valor) return quando || "Valor não informado";
    return quando ? `${valor} — ${quando}` : valor;
  });
  if (emAndamento.length > 1) {
    devolucoes.unshift("Já existem devoluções em andamento neste pedido:");
  }
  devolucoes.push(
    "Confirme só se esta for OUTRA devolução. Se a anterior ainda não aparece como concluída, aguarde alguns instantes antes de repetir.",
  );
  return devolucoes.join("\n");
}

type EstadoDoCartao =
  | "bloqueado_status"
  | "bloqueado_entregue"
  | "devolucao_em_andamento"
  | "bloqueado_retorno"
  | "reservado"
  | "tudo_devolvido"
  | "normal";

// Regra do dono (24/08/2026), a mesma que a RPC `solicitar_estorno` recusa
// no servidor — aqui só EXPLICA antes do clique. Ordem importa: um pedido
// não cancelado nunca chega a precisar do produto de volta. Saldo zero com
// valor RESERVADO (linha resolvida por fora que o Mercado Pago ainda não
// respondeu, pedido ainda pago) NÃO é "tudo devolvido": é dinheiro preso até
// o MP responder, e a tela diz isso.
function estadoDoCartao(
  order: Order,
  disponivel: number,
  reservado: number,
  tudoDevolvido: boolean,
): EstadoDoCartao {
  // Para entregues e cancelados, saldo zero também pode significar que o
  // servidor já descontou uma devolução em curso ou em dúvida. Só os baldes
  // do servidor fecham a conta: `valor_estornado` não inclui reembolso manual.
  const estadoSemSaldo =
    reservado > 0
      ? "reservado"
      : tudoDevolvido
        ? "tudo_devolvido"
        : "devolucao_em_andamento";

  // Pedido ENTREGUE não se cancela: com saldo, o caminho é a devolução do
  // produto (seção Devoluções da ficha).
  if (order.status === "delivered") {
    return disponivel > 0 ? "bloqueado_entregue" : estadoSemSaldo;
  }
  if (order.status !== "cancelled") return "bloqueado_status";
  if (order.cancelledAfterShipping && !order.returnedToSellerAt) {
    return "bloqueado_retorno";
  }
  if (disponivel <= 0) return estadoSemSaldo;
  return "normal";
}

export function EstornoCard({
  order,
  isOffline = false,
}: Readonly<EstornoCardProps>) {
  const {
    linhas,
    pago,
    devolvido,
    manual = 0,
    emCurso,
    emDuvida,
    disponivel,
    reservadoPorFora,
    carregando,
    pedidoCarregado,
    erro,
    recarregar,
    solicitarEstorno,
    registrarPorForaAposEspera,
    enviando,
  } = useEstornosDoPedido(order.id, order.status, order.paymentStatus);

  const { confirmar, dialogo } = useConfirmarAcao();
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
      <div className="space-y-3 rounded-2xl border border-admin-border bg-admin-surface p-5 text-white">
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
        {dialogo}
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
      <div className="space-y-4 rounded-2xl border border-admin-border bg-admin-surface p-5 text-white">
        <h3 className="text-sm font-medium text-zinc-200">
          Devolução de dinheiro
        </h3>
        <p className="text-xs text-zinc-400">Carregando…</p>
        {dialogo}
      </div>
    );
  }

  // O reservado só vale com o pedido ainda pago: estornado inteiro, a conta fechou.
  const reservado =
    order.paymentStatus === "estornado" ? 0 : Math.max(reservadoPorFora, 0);
  const estado = estadoDoCartao(
    order,
    disponivel,
    reservado,
    emCurso === 0 && emDuvida === 0,
  );
  const mostrarBotao =
    estado !== "tudo_devolvido" &&
    estado !== "reservado" &&
    estado !== "bloqueado_entregue" &&
    estado !== "devolucao_em_andamento";
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
    estado !== "normal" ? true : enviando || isOffline || !campoValido;

  // `repetindo`: o id da linha falhada que o "Tentar de novo" repete. O servidor repete ESSA linha uma vez só,
  // então duas abas (ou duas pessoas) tocando na mesma linha não mandam dois pedidos ao Mercado Pago.
  async function pedirConfirmacaoEEnviar(amount: number, repetindo?: string) {
    const valor = formatCurrency(amount);
    const aviso = repetindo ? "" : avisoDeDevolucoesEmAndamento(linhas);
    const confirmado = await confirmar({
      titulo: "Devolver o dinheiro ao cliente?",
      texto: `Devolver ${valor} ao cliente pelo Mercado Pago? O dinheiro sai da sua conta do Mercado Pago e não dá para desfazer.`,
      verbo: aviso ? "Confirmar devolução adicional" : `Devolver ${valor}`,
      valor,
      aviso,
    });
    if (!confirmado) return;
    await solicitarEstorno({
      amount,
      motivo: "",
      ...(repetindo ? { repetindo } : {}),
    });
  }

  return (
    <div className="space-y-4 rounded-2xl border border-admin-border bg-admin-surface p-5 text-white">
      <h3 className="text-sm font-medium text-zinc-200">
        Devolução de dinheiro
      </h3>

      <p className="text-xs font-bold text-zinc-400">
        Pago: {formatCurrency(pago)} · Devolvido:{" "}
        {formatCurrency(devolvido + manual)}
        {manual > 0 && ` (inclui ${formatCurrency(manual)} por fora)`} ·
        Disponível: {formatCurrency(disponivel)}
        {emDuvida > 0 && ` · Em confirmação: ${formatCurrency(emDuvida)}`}
      </p>

      {estado === "bloqueado_status" && (
        <p className="text-xs font-bold text-amber-400">
          Cancele o pedido antes de devolver o dinheiro.
        </p>
      )}
      {estado === "bloqueado_entregue" && (
        <p className="text-xs font-bold text-amber-400">
          Para devolver o dinheiro de um pedido já entregue, registre a
          devolução do produto em Devoluções.
        </p>
      )}
      {estado === "bloqueado_retorno" && (
        <p className="text-xs font-bold text-amber-400">
          {order.retiradaNaLoja
            ? "Para devolver o dinheiro, primeiro toque em “O produto voltou”, no aviso de pedidos cancelados (ícone ao lado do título Pedidos). A cliente não levou o produto: o toque só repõe o estoque e libera a devolução."
            : "Para devolver o dinheiro, primeiro confirme que o produto voltou, no aviso de pedidos cancelados (ícone ao lado do título Pedidos)."}
        </p>
      )}
      {estado === "tudo_devolvido" && (
        <p className="text-xs font-bold text-emerald-400">
          Todo o valor pago já foi devolvido.
        </p>
      )}
      {reservado > 0 && (
        <p className="text-xs font-bold text-amber-400">
          {textoReservado(formatCurrency(reservado))}
        </p>
      )}

      {mostrarBotao && (
        <div className="space-y-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11"
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
              className="min-h-11"
              onClick={() => setCampoAberto(true)}
            >
              devolver outro valor
            </Button>
          )}

          {podeAbrirCampo && campoAberto && (
            <div className="space-y-1">
              <label
                htmlFor={`valor-outro-estorno-${order.id}`}
                className="text-xs text-zinc-400"
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
                className="h-9 w-32 rounded-lg border-admin-border bg-zinc-950 text-xs text-white"
              />
              {!campoValido && (
                <p
                  id={`valor-outro-estorno-aviso-${order.id}`}
                  className="text-xs font-medium text-red-400"
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
          const { porForaAposEspera, jaPorFora } = acoesDaLinha(linha);
          return (
            <p key={linha.id} className="text-xs font-medium text-zinc-300">
              {texto}
              {jaPorFora && ` ${TEXTO_JA_POR_FORA}`}
              {podeTentarComSaldo && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="min-h-11"
                  disabled={enviando || isOffline}
                  onClick={() =>
                    pedirConfirmacaoEEnviar(linha.amount, linha.id)
                  }
                >
                  Tentar de novo
                </Button>
              )}
              {porForaAposEspera && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="min-h-11"
                  disabled={enviando || isOffline}
                  onClick={() =>
                    confirmouPorForaAposEspera(formatCurrency(linha.amount)) &&
                    registrarPorForaAposEspera(linha.id)
                  }
                >
                  {BOTAO_POR_FORA_APOS_ESPERA}
                </Button>
              )}
            </p>
          );
        })}
      </div>

      {carregando && linhas.length === 0 && (
        <p className="text-xs text-zinc-400">Carregando…</p>
      )}
      {dialogo}
    </div>
  );
}
