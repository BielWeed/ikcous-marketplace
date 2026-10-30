import {
  buscarConfiguracaoDeFrete,
  nomesDasTransportadorasLigadas,
} from "@/components/admin/settings/TransportadorasCard";
import { useEmailDaLoja } from "@/hooks/useEmailDaLoja";
import { type FatoDoEmail, fatoDoEmail } from "@/lib/passos-recomendados";
import { useEffect, useRef, useState } from "react";

/**
 * As duas leituras do cartão "pronta para vender" que não vêm da config da
 * loja (30/10/2026): o status do e-mail e as transportadoras ligadas. Nenhuma
 * é consulta nova — são as MESMAS chamadas que Ajustes (`useEmailDaLoja`, edge
 * `credenciais-email`) e Frete (`buscarConfiguracaoDeFrete`, edge
 * `calculate-shipping`) já fazem, e nenhuma devolve segredo (só "tem chave",
 * remetente e selo).
 *
 * O Início é aba mantida montada: a leitura se repete quando ele volta à vista
 * (depois de salvar o e-mail ou a transportadora em Ajustes/Frete), no máximo
 * uma vez a cada 30 s. `active === false` não lê.
 */

const INTERVALO_ENTRE_LEITURAS_MS = 30_000;

export interface RecomendadosLidos {
  readonly email: FatoDoEmail;
  /** `null` = a leitura não chegou ou falhou — o passo some, não chuta. */
  readonly nomesLigados: readonly string[] | null;
}

export function useRecomendadosDaLoja(active?: boolean): RecomendadosLidos {
  const { carga, status, recarregar } = useEmailDaLoja();
  const [nomesLigados, setNomesLigados] = useState<readonly string[] | null>(
    null,
  );
  // O e-mail já se lê sozinho ao montar; a transportadora ainda não leu nunca.
  const ultimaDoEmail = useRef(0);
  const ultimaDoFrete = useRef(0);
  // Só a leitura mais recente escreve: resposta atrasada de uma ida anterior
  // não sobrescreve a nova (mesmo cuidado de AdminSettingsView).
  const leituraDaVez = useRef(0);

  useEffect(() => {
    ultimaDoEmail.current = Date.now();
  }, []);

  useEffect(() => {
    if (active === false) return;
    const agora = Date.now();
    if (agora - ultimaDoEmail.current >= INTERVALO_ENTRE_LEITURAS_MS) {
      ultimaDoEmail.current = agora;
      void recarregar();
    }
    if (agora - ultimaDoFrete.current < INTERVALO_ENTRE_LEITURAS_MS) return;
    ultimaDoFrete.current = agora;
    const minha = ++leituraDaVez.current;
    void buscarConfiguracaoDeFrete().then((resultado) => {
      if (minha !== leituraDaVez.current) return;
      setNomesLigados(
        resultado.ok ? nomesDasTransportadorasLigadas(resultado.config) : null,
      );
    });
  }, [active, recarregar]);

  return { email: fatoDoEmail(carga, status), nomesLigados };
}
