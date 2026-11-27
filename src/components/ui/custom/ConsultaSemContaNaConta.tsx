import { OrderList } from "@/components/ui/custom/OrderList";
import { OrderSearch } from "@/components/ui/custom/OrderSearch";
import {
  EVENTO_RETRATO_LIMPO,
  PRAZO_DO_RETRATO_MS,
  apagarRetratoDoConvidado,
  lerRetratoDoConvidado,
  retratoVenceu,
  textoDoRetrato,
} from "@/lib/retrato-do-convidado";
import type { Order, View } from "@/types";
import { haptic } from "@/utils/haptic";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * "Meus pedidos" de quem ENTROU na conta (27/11/2026): o pedido feito sem
 * entrar na conta (ou com outro e-mail) não fica ligado a esta conta, e a
 * busca dele só existia fora dela. Aqui é a MESMA busca (OrderSearch, só o
 * rastreio) e o que ela acha aparece como o rastreio de fora da conta: um
 * retrato com o horário da consulta, que sai da tela em 15 minutos.
 *
 * A busca só acha pedido com e-mail (o gravado nele ou o da conta que
 * comprou): é o caminho do pedido feito em OUTRA conta. A compra sem conta
 * não grava e-mail e não aparece aqui — a tela manda falar com a loja.
 *
 * Quem monta (CartView) dá `key` com o id da conta: trocar ou sair da conta
 * desmonta tudo, e nada do que foi achado aparece para a próxima pessoa.
 */
export function ConsultaSemContaNaConta({
  onNavigate,
  whatsappDaLoja,
  onFechar,
}: Readonly<{
  onNavigate: (view: View, id?: string) => void;
  whatsappDaLoja?: string | null;
  onFechar: () => void;
}>) {
  const [achados, setAchados] = useState<{
    pedidos: Order[];
    consultadoEm: number;
  } | null>(null);
  const [saiuDaTela, setSaiuDaTela] = useState(false);
  // Remonta a busca do zero (mesmo gesto do "Consultar de novo" de fora da
  // conta): o formulário não fica no passo do código com os dados antigos.
  const [rodada, setRodada] = useState(0);
  const regiao = useRef<HTMLElement>(null);

  // O botão tocado (na lista vazia) sai de cena: o foco vem para cá, em vez
  // de cair no corpo da página.
  useEffect(() => {
    regiao.current?.focus();
  }, []);

  const recomecar = useCallback((porPrazo: boolean) => {
    setAchados(null);
    setSaiuDaTela(porPrazo);
    setRodada((n) => n + 1);
  }, []);

  // "Consultar de novo" nos detalhes do pedido apagou o retrato.
  useEffect(() => {
    const aoLimpar = () => recomecar(false);
    globalThis.addEventListener(EVENTO_RETRATO_LIMPO, aoLimpar);
    return () => globalThis.removeEventListener(EVENTO_RETRATO_LIMPO, aoLimpar);
  }, [recomecar]);

  // Mesmo prazo e mesmos gatilhos da lista de fora da conta (CartView): o
  // relógio dorme com o aparelho, a volta ao primeiro plano o acorda.
  const consultadoEm = achados?.consultadoEm ?? null;
  useEffect(() => {
    if (consultadoEm === null) return;
    const esvaziar = () => {
      recomecar(true);
      // A leitura apaga o retrato vencido do aparelho, se ainda estiver lá.
      lerRetratoDoConvidado();
    };
    if (retratoVenceu(consultadoEm)) {
      esvaziar();
      return;
    }
    const aoVoltarAoPrimeiroPlano = () => {
      if (
        document.visibilityState === "visible" &&
        retratoVenceu(consultadoEm)
      ) {
        esvaziar();
      }
    };
    document.addEventListener("visibilitychange", aoVoltarAoPrimeiroPlano);
    const relogio = setTimeout(
      esvaziar,
      consultadoEm + PRAZO_DO_RETRATO_MS - Date.now() + 1,
    );
    return () => {
      clearTimeout(relogio);
      document.removeEventListener("visibilitychange", aoVoltarAoPrimeiroPlano);
    };
  }, [consultadoEm, recomecar]);

  return (
    <section
      ref={regiao}
      tabIndex={-1}
      aria-label="Consultar pedido feito em outra conta"
      className="mb-4 focus:outline-none"
    >
      {saiuDaTela && !achados && (
        <div
          role="status"
          className="mb-4 rounded-2xl border border-solid border-border bg-background px-4 py-3 text-[13px] font-medium text-foreground"
        >
          Por segurança, os pedidos que você consultou saem da tela depois de 15
          minutos. Consulte de novo com o seu e-mail e o código do pedido.
        </div>
      )}
      {achados ? (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-solid border-border bg-background px-4 py-3">
            <p className="flex min-w-0 flex-1 items-start gap-2 text-[13px] font-medium text-foreground">
              <span
                aria-hidden="true"
                className="mt-1.5 size-1.5 shrink-0 rounded-full bg-amber-500"
              />
              <span className="min-w-0">
                {textoDoRetrato(achados.consultadoEm)}
              </span>
            </p>
            <button
              type="button"
              onClick={() => {
                haptic.light();
                apagarRetratoDoConvidado();
                recomecar(false);
              }}
              className="min-h-11 rounded-xl bg-foreground px-4 text-sm font-bold text-background transition-all active:scale-95"
            >
              Consultar de novo
            </button>
          </div>
          <OrderList orders={achados.pedidos} onNavigate={onNavigate} />
        </>
      ) : (
        <OrderSearch
          key={rodada}
          somenteRastreio
          abrirNoRastreio
          onNavigate={onNavigate}
          whatsappDaLoja={whatsappDaLoja}
          onOrdersFound={(pedidos) => {
            // OrderSearch acabou de gravar o retrato (é por ele que os
            // detalhes do pedido abrem): o horário é o de agora.
            setAchados({ pedidos, consultadoEm: Date.now() });
            setSaiuDaTela(false);
          }}
        />
      )}
      <button
        type="button"
        onClick={() => {
          haptic.light();
          apagarRetratoDoConvidado();
          onFechar();
        }}
        className="mt-2 min-h-11 w-full text-center text-sm font-semibold text-foreground underline underline-offset-4"
      >
        Fechar consulta
      </button>
    </section>
  );
}
