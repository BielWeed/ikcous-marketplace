import { chavePublicaMercadoPago } from "@/config/configuracaoDaLoja";
import {
  type ConfigDoCartao,
  cartaoLigado,
  esquecerConfigDoCartao,
  lerConfigDoCartao,
} from "@/lib/config-do-cartao";
import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * O que o checkout sabe, num instante, sobre o cartão pelo app. Antes era
 * `ConfigDoCartao | null`, e o `null` misturava QUATRO coisas que pedem
 * tratamentos diferentes: ainda carregando, leitura que falhou, cartão
 * desligado de verdade e loja sem Public Key. Bug do teste real da
 * 1.5.14/1.5.15 (02/10/2026): na retomada de pagamento, a lista de formas
 * aparecia só com PIX enquanto a config carregava — o cliente que escolheu
 * cartão via uma lista parcial como se fosse final, e erro de leitura
 * parecia "cartão desligado".
 *
 * - `carregando`: a leitura está no ar. Quem consome NÃO mostra lista de
 *   formas como se fosse final.
 * - `erro`: a leitura falhou (ou passou de `TEMPO_LIMITE_DA_LEITURA_MS`).
 *   NÃO é "desligado" e não fica em cache; `tentarDeNovo` refaz a leitura e o
 *   estado volta a `carregando`. O PIX não depende desta config e continua
 *   ofertável.
 * - `pronto`: a resposta é definitiva. `config` é a config LIGADA, ou `null`
 *   quando o cartão não deve ser oferecido DE VERDADE — crédito e débito
 *   desligados, linha ausente, loja sem a Public Key do Mercado Pago na
 *   ficha (sem ela o Brick nem monta) ou pagamento pelo app desligado
 *   (`ativo` falso, que nem vai ao banco).
 */
export type EstadoDaConfigDoCartao =
  | { readonly estado: "carregando" }
  | { readonly estado: "erro"; readonly tentarDeNovo: () => void }
  | { readonly estado: "pronto"; readonly config: ConfigDoCartao | null };

/**
 * Leitura que não responde em tempo hábil vira `erro`: sem isto, uma conexão
 * pendurada deixaria a tela de retomada em "carregando" para sempre, sem
 * botão de forma nenhum (nem PIX). Se a resposta chegar depois, o estado
 * ainda vira `pronto` — o tempo só devolve a saída ao cliente.
 */
export const TEMPO_LIMITE_DA_LEITURA_MS = 15_000;

type LeituraInterna =
  | Exclude<EstadoDaConfigDoCartao, { estado: "erro" }>
  | typeof ERRO;

const CARREGANDO = Object.freeze({ estado: "carregando" } as const);
const ERRO = Object.freeze({ estado: "erro" } as const);
const PRONTO_SEM_CARTAO: EstadoDaConfigDoCartao = Object.freeze({
  estado: "pronto",
  config: null,
});

/**
 * A config do cartão pelo app, para o CHECKOUT. Os objetos devolvidos têm
 * identidade ESTÁVEL entre renders enquanto nada muda (o CheckoutView tem
 * efeitos e memos que dependem disso).
 *
 * `ativo` falso (pagamento pelo app desligado na loja) ou loja sem Public
 * Key: `pronto` com `null` já no primeiro render, sem passar por
 * `carregando` e sem ir ao banco.
 */
export function useConfigDoCartao(ativo: boolean): EstadoDaConfigDoCartao {
  // A leitura carrega a CHAVE da rodada que a produziu: trocar de rodada
  // ("Tentar de novo") torna a leitura anterior invisível NO MESMO render,
  // sem `setState` dentro de efeito.
  const [resultado, setResultado] = useState<{
    readonly chave: string;
    readonly leitura: LeituraInterna;
  } | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const chave = `${ativo}|${tentativa}`;
  // Loja sem a Public Key do Mercado Pago na ficha: o Brick nem monta, então
  // o hook já devolve `pronto` com `null` (abaixo) — e o effect não tem o que
  // ler nem o que cronometrar.
  const temChavePublica = !!chavePublicaMercadoPago();

  useEffect(() => {
    if (!ativo || !temChavePublica) return;
    let vivo = true;
    const relogio = setTimeout(() => {
      if (vivo) setResultado({ chave, leitura: ERRO });
    }, TEMPO_LIMITE_DA_LEITURA_MS);
    lerConfigDoCartao().then((lida) => {
      if (!vivo) return;
      clearTimeout(relogio);
      setResultado({
        chave,
        leitura: lida.ok
          ? {
              estado: "pronto",
              config: cartaoLigado(lida.config) ? lida.config : null,
            }
          : ERRO,
      });
    });
    return () => {
      vivo = false;
      clearTimeout(relogio);
    };
  }, [ativo, temChavePublica, chave]);

  const tentarDeNovo = useCallback(() => {
    // Esquece o cache: uma leitura ainda PENDURADA no ar (o caso do tempo
    // limite) estaria em cache e a nova tentativa só reaproveitaria a mesma
    // promessa parada. Só se chega aqui vindo de `erro`, quando não há
    // sucesso em cache para perder.
    esquecerConfigDoCartao();
    setTentativa((n) => n + 1);
  }, []);

  const leitura = resultado?.chave === chave ? resultado.leitura : CARREGANDO;
  const estado = useMemo<EstadoDaConfigDoCartao>(
    () =>
      leitura.estado === "erro" ? { estado: "erro", tentarDeNovo } : leitura,
    [leitura, tentarDeNovo],
  );

  if (!ativo || !temChavePublica) return PRONTO_SEM_CARTAO;
  return estado;
}
