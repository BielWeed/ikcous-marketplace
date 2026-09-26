import { chavePublicaMercadoPago } from "@/config/configuracaoDaLoja";
import {
  type ConfigDoCartao,
  cartaoLigado,
  lerConfigDoCartao,
} from "@/lib/config-do-cartao";
import { useEffect, useState } from "react";

/**
 * A config do cartão pelo app, para o CHECKOUT — ou `null` quando o cartão
 * NÃO deve ser oferecido: ainda carregando, leitura que falhou, crédito e
 * débito desligados, ou loja sem a Public Key do Mercado Pago na ficha (sem
 * ela o Brick nem monta). Um `null` só, para quem consome não ter como
 * oferecer cartão por um caminho que esqueceu de checar.
 *
 * `ativo` falso (pagamento pelo app desligado na loja) não vai ao banco.
 */
export function useConfigDoCartao(ativo: boolean): ConfigDoCartao | null {
  const [config, setConfig] = useState<ConfigDoCartao | null>(null);

  useEffect(() => {
    if (!ativo) return;
    let vivo = true;
    lerConfigDoCartao().then((lida) => {
      if (!vivo) return;
      setConfig(cartaoLigado(lida) ? lida : null);
    });
    return () => {
      vivo = false;
    };
  }, [ativo]);

  if (!ativo || !chavePublicaMercadoPago()) return null;
  return config;
}
