import {
  CHAVE_CONFIGURACAO_CARTAO,
  type ConfiguracaoCartao,
  aceitaAlgumCartao,
  lerConfiguracaoCartao,
} from "@/lib/configuracaoCartao";
import { supabase } from "@/lib/supabase";
import { useEffect, useState } from "react";

/**
 * O que a tela oferece quando NÃO consegue ler a configuração do cartão:
 * só PIX. Falha fechada para o cartão — oferecer um cartão que o lojista
 * desligou faria o cliente preencher o formulário para ouvir "esta loja não
 * aceita" do servidor. O PIX não depende desta configuração.
 */
export const CONFIGURACAO_SO_PIX: ConfiguracaoCartao = {
  credito: false,
  debito: false,
  parcelasMax: null,
};

export type EstadoConfiguracaoCartao =
  | { readonly estado: "carregando" }
  | { readonly estado: "pronto"; readonly config: ConfiguracaoCartao };

/**
 * Lê a configuração do cartão do lojista (`app_settings`, linha
 * 'pagamentos_cartao' — policy da migration 20261160000100: cliente logado
 * lê SÓ essa linha). Plano docs/superpowers/plans/2026-09-30-cartao-de-
 * credito-e-debito.md, T5.
 *
 * `ativo` = pagar pelo app está ligado E há sessão (P6: só cliente logado
 * paga online). Desativado, não consulta nada e fica em "carregando" — quem
 * chama não mostra o Brick nesse estado de qualquer jeito.
 *
 * NUNCA lança: linha ausente é o padrão (tudo ligado); erro de leitura ou
 * valor ilegível vira CONFIGURACAO_SO_PIX, com o motivo no console. A trava
 * que vale é do servidor, que relê a mesma linha.
 *
 * ATENÇÃO (MENOR 5 da revisão): negação por RLS NÃO é erro — sem a policy da
 * migration 20261160000100 a leitura devolve "nenhuma linha", e isso cai no
 * PADRÃO, não no só-PIX. O servidor continua recusando o cartão que o
 * lojista desligou; só a tela oferece a mais.
 */
export function useConfiguracaoCartao(
  ativo: boolean,
): EstadoConfiguracaoCartao {
  const [estado, setEstado] = useState<EstadoConfiguracaoCartao>({
    estado: "carregando",
  });

  useEffect(() => {
    if (!ativo) return;
    let cancelado = false;
    (async () => {
      let config = CONFIGURACAO_SO_PIX;
      try {
        const { data, error } = await supabase
          .from("app_settings")
          .select("value")
          .eq("key", CHAVE_CONFIGURACAO_CARTAO)
          .maybeSingle();
        if (error) throw error;
        const leitura = lerConfiguracaoCartao(data?.value ?? null);
        if (leitura.ok) {
          config = leitura.config;
        } else {
          console.error(
            "useConfiguracaoCartao: configuração do cartão ilegível — oferecendo só PIX",
          );
        }
      } catch (erro) {
        console.error(
          "useConfiguracaoCartao: falha ao ler a configuração do cartão — oferecendo só PIX",
          erro,
        );
      }
      if (!cancelado) setEstado({ estado: "pronto", config });
    })();
    return () => {
      cancelado = true;
    };
  }, [ativo]);

  return estado;
}

/**
 * O rótulo da opção "Pagar agora" no checkout. Diz o que o Brick VAI
 * oferecer — nunca promete o que o código nega (lição da Fase 3, quando
 * "(PIX ou cartão)" sobreviveu ao cartão desligado). Carregando ou com
 * falha de leitura, o Brick oferece só PIX, e o rótulo acompanha.
 */
export function rotuloPagarAgora(estado: EstadoConfiguracaoCartao): string {
  return estado.estado === "pronto" && aceitaAlgumCartao(estado.config)
    ? "Pagar agora (PIX ou cartão)"
    : "Pagar agora com PIX";
}
