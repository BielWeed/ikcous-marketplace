import { normalizarNumeroMototaxi } from "@/components/admin/minha-loja/contato";
import {
  MENSAGEM_MOTOTAXI_SEM_RESPOSTA,
  PRAZO_DA_CONSULTA_DO_PAINEL_MS,
  PRAZO_DE_GRAVAR_O_CONTATO_DO_MOTOTAXI_MS,
  aguardarComPrazo,
  ehConsultaSemResposta,
  erroDeConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
import { supabase } from "@/lib/supabase";
import { useCallback, useEffect, useState } from "react";

export interface ConfigMototaxi {
  whatsapp: string | null;
  nome: string | null;
}

/** Só componentes do painel. Nunca passa pelo StoreContext, vault ou storage público.
 * O sinal só dispara leitura nova quando muda (ex.: voltar à aba), não é uma trava. */
export function useMototaxi(sinalDeReleitura?: boolean) {
  const [config, setConfig] = useState<ConfigMototaxi | null>(null);
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);
  useEffect(() => {
    let atual = true;
    async function ler() {
      try {
        // Rede pendurada vira o erro com nova tentativa já usado no painel;
        // a resposta tardia desta leitura não sobrescreve a tentativa seguinte.
        const { data, error } = await aguardarComPrazo(
          Promise.resolve(
            supabase
              .from("config_mototaxi")
              .select("whatsapp,nome")
              .eq("id", 1)
              .maybeSingle(),
          ),
          PRAZO_DA_CONSULTA_DO_PAINEL_MS,
          () => erroDeConsultaSemResposta(),
        );
        if (!atual) return;
        if (error) throw error;
        setConfig(data ?? { whatsapp: null, nome: null });
        setErro(false);
      } catch {
        if (atual) {
          setConfig(null);
          setErro(true);
        }
      }
    }
    void ler();
    return () => {
      atual = false;
    };
  }, [sinalDeReleitura, tentativa]);

  const salvar = async (valor: ConfigMototaxi): Promise<boolean> => {
    const whatsapp = normalizarNumeroMototaxi(valor.whatsapp);
    if (valor.whatsapp?.trim() && !whatsapp) return false;
    const nome = valor.nome?.trim() || null;
    if (nome && nome.length > 80) return false;
    try {
      // Rede pendurada: sem prazo o Salvar do frete ficava em "Salvando…" para
      // sempre. Sem resposta NÃO é falha do servidor (o contato pode ter sido
      // gravado): o erro com a frase pronta sobe para a tela, que a mostra.
      const { data, error } = await aguardarComPrazo(
        Promise.resolve(
          supabase.rpc("salvar_config_mototaxi", {
            p_whatsapp: whatsapp,
            p_nome: nome,
          }),
        ),
        PRAZO_DE_GRAVAR_O_CONTATO_DO_MOTOTAXI_MS,
        () => erroDeConsultaSemResposta(MENSAGEM_MOTOTAXI_SEM_RESPOSTA),
      );
      if (
        error ||
        !data ||
        Array.isArray(data) ||
        typeof data !== "object" ||
        data.whatsapp !== whatsapp ||
        data.nome !== nome
      )
        return false;
      setConfig({ whatsapp, nome });
      setErro(false);
      return true;
    } catch (erro) {
      if (ehConsultaSemResposta(erro)) throw erro;
      return false;
    }
  };
  return { config, erro, recarregar, salvar };
}
