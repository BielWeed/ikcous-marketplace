// A REVISÃO DA CONFIGURAÇÃO DE FRETE (release 1.5.7, CONTRATO-1.5.7.md
// R1-2 e R2-8) — módulo único para o navegador saber "a lojista mudou algo
// no frete desde a última vez que eu consultei?" e para descartar o cache
// que ficaria servindo o preço de ANTES da mudança.
//
// Dono: pacote C. O painel (pacote P) só IMPORTA
// `descartarCacheDeFreteDoNavegador` depois de salvar — não decide nada
// sozinho, para as duas telas nunca divergirem sobre o que "revisão mudou"
// significa.
import { supabase } from "@/lib/supabase";

/**
 * Pergunta à edge qual é a revisão ATUAL da configuração de frete da loja
 * (provedores ligados, serviços marcados, seguro, sandbox — nunca o token).
 * Ação PÚBLICA (R1-2): não exige admin nem CEP, não cota nenhuma
 * transportadora, só calcula o hash. `null` cobre TODA falha (rede, corpo
 * sem o campo, erro do lado do servidor) — fail closed: quem chama trata
 * `null` como "não dá para confiar no cache agora", nunca como "sem
 * mudança".
 */
export async function buscarRevisaoConfigFrete(): Promise<string | null> {
  try {
    const { data, error } = await supabase.functions.invoke(
      "calculate-shipping",
      { body: { action: "revisao_config_frete" } },
    );
    if (error) return null;
    const revisao = (data as { revisaoConfig?: unknown } | null | undefined)
      ?.revisaoConfig;
    return typeof revisao === "string" && revisao.length > 0 ? revisao : null;
  } catch {
    return null;
  }
}

/**
 * O prefixo é o MESMO que `AuthContext.tsx` (`clearLocalUserData`) já varre
 * no logout — não um segundo conjunto de chaves para os dois divergirem.
 * Cobre a chave viva (`ikcous_shipping_cache_v2_<CEP>`) e qualquer versão
 * anterior que ainda esteja em disco.
 */
const PREFIXO_DO_CACHE_DE_FRETE = "ikcous_shipping_cache_";

/**
 * Apaga TODO o cache de frete do navegador deste aparelho — usada quando a
 * configuração muda (o painel, depois de `save_credentials`/
 * `save_active_providers`) e sempre que ESTE módulo detecta uma revisão
 * diferente da que uma entrada guardou. Nunca falha: `localStorage`
 * indisponível (SSR, aba privada bloqueando storage) só faz o laço não
 * rodar.
 */
export function descartarCacheDeFreteDoNavegador(): void {
  if (typeof window === "undefined") return;
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const chave = localStorage.key(i);
      if (chave?.startsWith(PREFIXO_DO_CACHE_DE_FRETE)) {
        localStorage.removeItem(chave);
      }
    }
  } catch {
    // Storage bloqueado/indisponível: nada para descartar.
  }
}
