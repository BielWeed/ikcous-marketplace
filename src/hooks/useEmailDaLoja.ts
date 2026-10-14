import {
  type AcaoDoEmail,
  type FalhaDaChamada,
  type StatusDoEmail,
  comoMotivo,
  lerStatusDoEmail,
  mensagemDoMotivo,
  traduzirFalha,
} from "@/components/admin/settings/email-da-loja-conteudo";
import { supabase } from "@/lib/supabase";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Fala com a edge `credenciais-email` (14/10/2026): a lojista cadastra o Gmail
 * da loja no painel. Quem GUARDA, VERIFICA e TESTA é o servidor; este hook só
 * leva o pedido (com a sessão da lojista, que o SDK já anexa) e traduz o
 * resultado.
 *
 * REGRAS DE SEGURANÇA
 *  - A senha passa por aqui UMA vez, a caminho do servidor. Não entra em estado
 *    do hook, em log, nem em mensagem: o que sobra depois de `salvar` é só o
 *    status que o servidor devolve (e ele nunca devolve a senha).
 *  - O texto de erro do servidor (`erro`) NUNCA vira mensagem: quem traduz é
 *    `traduzirFalha`, pelo CÓDIGO (`motivo`, lista fechada) e pelo status HTTP.
 *  - Nada de `console.log` e nenhum evento de analytics.
 *
 * Uma ação por vez (`ocupado`): o clique duplo não manda dois pedidos (cada
 * `salvar`/`testar` gasta a cota de tentativas do servidor junto ao Google).
 */

export type CargaDoEmail = "carregando" | "pronto" | "indisponivel" | "erro";
export type OcupadoDoEmail = null | "salvando" | "testando" | "removendo";
export type ResultadoDaAcao = { ok: true } | { ok: false; mensagem: string };

export interface UseEmailDaLoja {
  readonly carga: CargaDoEmail;
  /** Frase para a tela quando `carga` é "indisponivel" ou "erro". */
  readonly mensagemDeCarga: string | null;
  readonly status: StatusDoEmail | null;
  readonly ocupado: OcupadoDoEmail;
  recarregar: () => Promise<void>;
  salvar: (usuario: string, senha: string) => Promise<ResultadoDaAcao>;
  testar: () => Promise<ResultadoDaAcao>;
  remover: () => Promise<ResultadoDaAcao>;
}

const FUNCAO = "credenciais-email";
const MENSAGEM_OCUPADO = "Espere terminar o que já está em andamento.";
const MENSAGEM_RESPOSTA_TORTA =
  "Não entendi a resposta do servidor. Tente de novo em instantes.";

/** O que o SDK nos entregou, reduzido ao que a tradução precisa (sem texto do servidor). */
async function lerFalha(error: unknown): Promise<FalhaDaChamada> {
  const e = (error ?? {}) as { name?: unknown; context?: unknown };
  if (e.name === "FunctionsHttpError" && e.context instanceof Response) {
    const corpo = (await e.context
      .clone()
      .json()
      .catch(() => null)) as {
      motivo?: unknown;
      espere_segundos?: unknown;
    } | null;
    return {
      status: e.context.status,
      motivo: corpo?.motivo,
      espereSegundos: corpo?.espere_segundos,
    };
  }
  if (e.name === "FunctionsFetchError") {
    return { semResposta: true, offline: navigator.onLine === false };
  }
  return {};
}

export function useEmailDaLoja(): UseEmailDaLoja {
  const [carga, setCarga] = useState<CargaDoEmail>("carregando");
  const [mensagemDeCarga, setMensagemDeCarga] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusDoEmail | null>(null);
  const [ocupado, setOcupado] = useState<OcupadoDoEmail>(null);
  const ocupadoRef = useRef<OcupadoDoEmail>(null);

  const chamar = useCallback(async (corpo: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke(FUNCAO, {
      body: corpo,
    });
    return { data: data as unknown, error: error as unknown };
  }, []);

  /**
   * Lê o status. `silencioso` (releitura depois de uma ação): se falhar, a tela
   * segue com o que já tinha, em vez de trocar o formulário por um erro.
   */
  const lerStatus = useCallback(
    async (silencioso: boolean) => {
      setCarga((antes) => (antes === "pronto" ? antes : "carregando"));
      try {
        const { data, error } = await chamar({ acao: "status" });
        if (error) throw error;
        const lido = lerStatusDoEmail(data);
        if (!lido) {
          if (silencioso) return;
          setCarga("erro");
          setMensagemDeCarga(MENSAGEM_RESPOSTA_TORTA);
          return;
        }
        setStatus(lido);
        setMensagemDeCarga(null);
        setCarga("pronto");
      } catch (erro) {
        if (silencioso) return;
        const traduzida = traduzirFalha(await lerFalha(erro), "status");
        setMensagemDeCarga(traduzida.mensagem);
        setCarga(traduzida.indisponivel ? "indisponivel" : "erro");
      }
    },
    [chamar],
  );

  const recarregar = useCallback(() => lerStatus(false), [lerStatus]);

  useEffect(() => {
    void lerStatus(false);
  }, [lerStatus]);

  /** Roda UMA ação por vez; o resto da tela só vê `ocupado` e o resultado. */
  const executar = useCallback(
    async (
      nome: Exclude<OcupadoDoEmail, null>,
      acao: AcaoDoEmail,
      trabalho: () => Promise<ResultadoDaAcao>,
    ): Promise<ResultadoDaAcao> => {
      if (ocupadoRef.current) {
        return { ok: false, mensagem: MENSAGEM_OCUPADO };
      }
      ocupadoRef.current = nome;
      setOcupado(nome);
      try {
        return await trabalho();
      } catch (erro) {
        return {
          ok: false,
          mensagem: traduzirFalha(await lerFalha(erro), acao).mensagem,
        };
      } finally {
        ocupadoRef.current = null;
        setOcupado(null);
      }
    },
    [],
  );

  /** `salvar` e `remover` devolvem o status novo: aplica, ou relê se vier torto. */
  const aplicarStatusDevolvido = useCallback(
    async (data: unknown): Promise<ResultadoDaAcao> => {
      const lido = lerStatusDoEmail(data);
      if (!lido) {
        await lerStatus(true);
        return { ok: false, mensagem: MENSAGEM_RESPOSTA_TORTA };
      }
      setStatus(lido);
      setCarga("pronto");
      return { ok: true };
    },
    [lerStatus],
  );

  const salvar = useCallback(
    (usuario: string, senha: string) =>
      executar("salvando", "salvar", async () => {
        const { data, error } = await chamar({
          acao: "salvar",
          usuario,
          senha,
        });
        if (error) throw error;
        return aplicarStatusDevolvido(data);
      }),
    [chamar, executar, aplicarStatusDevolvido],
  );

  const remover = useCallback(
    () =>
      executar("removendo", "remover", async () => {
        const { data, error } = await chamar({ acao: "remover" });
        if (error) throw error;
        return aplicarStatusDevolvido(data);
      }),
    [chamar, executar, aplicarStatusDevolvido],
  );

  const testar = useCallback(
    () =>
      executar("testando", "testar", async () => {
        const { data, error } = await chamar({ acao: "testar" });
        if (error) throw error;
        const resposta = (data ?? {}) as { ok?: unknown; motivo?: unknown };
        // O teste gravou o resultado no servidor (selo e saúde): relê o status.
        await lerStatus(true);
        // Só `ok === true` é sucesso: resposta torta nunca vira "e-mail enviado".
        if (resposta.ok === true) return { ok: true };
        const motivo = comoMotivo(resposta.motivo);
        return {
          ok: false,
          mensagem:
            resposta.ok === false
              ? mensagemDoMotivo(motivo)
              : MENSAGEM_RESPOSTA_TORTA,
        };
      }),
    [chamar, executar, lerStatus],
  );

  return {
    carga,
    mensagemDeCarga,
    status,
    ocupado,
    recarregar,
    salvar,
    testar,
    remover,
  };
}
