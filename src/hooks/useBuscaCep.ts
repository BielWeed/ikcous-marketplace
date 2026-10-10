import { PROVEDORES_DE_CEP } from "@/lib/provedores-de-cep";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Une as duas cópias de busca de CEP (AddressForm.tsx e o checkout de
 * convidado em CheckoutView.tsx) atrás de uma única implementação. Fecha
 * três defeitos rastreados como issues:
 *
 * - #184 corrida: cada busca guarda um número de sequência; uma resposta
 *   que chega depois de uma busca mais nova já ter começado é descartada.
 * - #185 sem timeout: se o ViaCEP pendurar a conexão, o `finally` nunca
 *   rodava e o campo de CEP ficava `disabled` para sempre.
 * - #186 sem abort no desmonte: cancelar o formulário durante a busca
 *   deixava o toast de sucesso aparecer por cima da tela seguinte.
 *
 * E um quarto, medido em 03/10/2026 ("o CEP não pega para todo lugar"): o
 * ViaCEP sozinho não acha ~13% dos CEPs que existem e responde "não existe"
 * como se a cliente tivesse errado. A busca agora percorre uma cadeia de
 * provedores gratuitos (`PROVEDORES_DE_CEP`, em ordem): o primeiro que
 * devolve um endereço vence; "CEP não encontrado" só quando TODOS dizem que
 * não existe. As três guardas acima valem em cada tentativa da cadeia.
 */

// Os quatro campos vêm normalizados de `provedores-de-cep.ts`; o provedor
// devolve "" — ou o campo ausente — quando não tem o dado (CEP único de
// cidade pequena não tem rua nem bairro). `string` puro mentiria para
// o próximo consumidor; os dois chamadores já guardam atrás de `if
// (endereco.logradouro)` etc., então o `undefined` aqui não muda comportamento.
export interface EnderecoDoCep {
  logradouro: string | undefined;
  bairro: string | undefined;
  localidade: string | undefined;
  uf: string | undefined;
}

/**
 * Teto da busca INTEIRA (todos os provedores somados) antes de desistir
 * (#185). É o mesmo 8 s que a cliente já esperava com um provedor só.
 */
export const TIMEOUT_BUSCA_CEP_MS = 8000;

/**
 * Espera máxima por UM provedor. Medido: respondem em 0,03 a 0,4 s; 3 s é
 * folga para rede ruim de celular e deixa os 3 provedores caberem no teto
 * geral (3 + 3 + 2 s) quando os dois primeiros penduram.
 */
export const TIMEOUT_TENTATIVA_CEP_MS = 3000;

/**
 * Como a última busca TERMINOU, para a tela contar à cliente sem depender do
 * toast (some em 2,5 s, longe do campo que ela está olhando). `null` = nenhuma
 * busca terminada (nunca buscou, está em voo, ou o CEP foi editado depois).
 *
 * - `achou`: um provedor devolveu endereço (a tela decide se veio completo).
 * - `naoEncontrado`: TODOS os provedores responderam "esse CEP não existe".
 * - `demorou`: a busca estourou o tempo (teto geral ou de uma tentativa).
 * - `indisponivel`: sem rede / provedores fora do ar / "não existe" misturado
 *   com falha — afirmar "não encontrado" aí seria chute.
 */
export type ResultadoBuscaCep = {
  tipo: "achou" | "naoEncontrado" | "demorou" | "indisponivel";
};

export interface OpcoesBuscaCep {
  /**
   * Padrão `true`: o desfecho também sai como toast (checkout de convidado,
   * que sempre foi assim). A tela de endereço passa `false` e mostra o aviso
   * dentro da tela, a partir de `resultado`.
   */
  avisarPorToast?: boolean;
}

/** Formata "38500000" em "38500-000". Os dois chamadores fazem isto igual. */
export function formatarCep(bruto: string): {
  limpo: string;
  formatado: string;
} {
  const limpo = bruto.replace(/\D/g, "");
  const formatado =
    limpo.length > 5 ? `${limpo.slice(0, 5)}-${limpo.slice(5, 8)}` : limpo;
  return { limpo, formatado };
}

export function useBuscaCep(
  aoEncontrar: (endereco: EnderecoDoCep) => void,
  opcoes?: OpcoesBuscaCep,
): {
  buscando: boolean;
  buscar: (cepLimpo: string) => Promise<void>;
  resultado: ResultadoBuscaCep | null;
  /** Apaga o desfecho velho (a cliente editou o CEP depois da busca). */
  limpar: () => void;
} {
  const [buscando, setBuscando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoBuscaCep | null>(null);

  // Lido por ref pelo mesmo motivo de `aoEncontrar`: `buscar` não é recriada.
  const avisarPorToastRef = useRef(opcoes?.avisarPorToast !== false);
  avisarPorToastRef.current = opcoes?.avisarPorToast !== false;

  // Lido por ref para que o chamador não precise memoizar a callback e
  // `buscar` não precise ser recriada a cada render.
  const aoEncontrarRef = useRef(aoEncontrar);
  aoEncontrarRef.current = aoEncontrar;

  const sequenciaRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const desmontadoRef = useRef(false);

  useEffect(() => {
    desmontadoRef.current = false; // repõe o flag a cada (re)montagem do efeito
    return () => {
      desmontadoRef.current = true;
      controllerRef.current?.abort();
    };
  }, []);

  const buscar = useCallback(async (cepLimpo: string) => {
    if (cepLimpo.length !== 8) return;

    // Cancela a busca anterior de verdade, em vez de só ignorar a resposta
    // dela quando chegar.
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    const sequencia = ++sequenciaRef.current;
    // Uma busca mais nova já começou, ou o componente já desmontou: tudo o
    // que esta busca ainda tiver a dizer chegou velho e é descartado sem
    // tocar no formulário, sem toast e sem consultar o próximo provedor.
    const superada = () =>
      sequencia !== sequenciaRef.current || desmontadoRef.current;

    // Distingue o teto geral de cancelamento por busca nova: uma variável
    // local no closure desta busca, marcada pelo callback do timer antes do
    // `abort()`. Nada de `abort(motivo)` nem `AbortSignal.any` — suporte
    // irregular e recente demais para este projeto.
    let estourouOTeto = false;
    const timerDoTeto = setTimeout(() => {
      estourouOTeto = true;
      controller.abort();
    }, TIMEOUT_BUSCA_CEP_MS);

    setBuscando(true);
    setResultado(null);
    try {
      let naoExiste = 0; // provedores que RESPONDERAM "esse CEP não existe"
      let estourouTentativa = false;

      for (const provedor of PROVEDORES_DE_CEP) {
        if (controller.signal.aborted) break;

        // Cada tentativa tem o próprio sinal e o próprio timer: um provedor
        // pendurado não come o teto inteiro e o próximo ainda é consultado.
        // O sinal da busca (nova busca, desmonte, teto) cancela a tentativa.
        const tentativa = new AbortController();
        const repassaCancelamento = () => tentativa.abort();
        controller.signal.addEventListener("abort", repassaCancelamento);
        let tentativaEstourou = false;
        const timerDaTentativa = setTimeout(() => {
          tentativaEstourou = true;
          tentativa.abort();
        }, TIMEOUT_TENTATIVA_CEP_MS);

        try {
          const res = await fetch(provedor.url(cepLimpo), {
            signal: tentativa.signal,
          });

          // Um 500 (ou outro erro HTTP) costuma vir com corpo HTML — tentar
          // `.json()` nele estoura `SyntaxError`. Confere `ok` ANTES de
          // tentar interpretar o corpo. `=== false` e não `!res.ok`: um
          // `Response` de verdade nunca deixa `ok` indefinido, mas os mocks
          // dos testes do hook e dos consumidores (AddressForm, checkout de
          // convidado) simulam só `{ json }` — tratar "não confirmado bom"
          // como erro quebraria esses testes por um detalhe de mock.
          //
          // O 404 é a exceção: OpenCEP e AwesomeAPI avisam "esse CEP não
          // existe" assim, com um JSON no corpo. Só vale como "não existe"
          // se o corpo for esse JSON; 404 de proxy (HTML) é falha.
          let dados: unknown;
          if (res.ok === false) {
            if (res.status !== 404) continue;
            dados = await res.json().catch(() => null);
          } else {
            dados = await res.json();
          }

          if (superada()) return;

          const leitura = provedor.ler(dados);
          if (leitura.tipo === "achou") {
            aoEncontrarRef.current(leitura.endereco);
            setResultado({ tipo: "achou" });
            if (avisarPorToastRef.current) toast.success("CEP localizado!");
            return;
          }
          // Este provedor não tem o CEP (ou respondeu lixo): segue para o
          // próximo. O ViaCEP sozinho errava "não existe" em ~13% dos CEPs
          // reais, então um "não" dele não encerra a busca.
          if (leitura.tipo === "naoEncontrado") naoExiste++;
        } catch (err) {
          // Cancelamento não é erro, não loga. Confere por `name`, nunca por
          // `instanceof DOMException`: em jsdom o `AbortError` vem de outro
          // realm e o `instanceof` dá `false`, jogando um cancelamento
          // legítimo no `console.error`.
          if ((err as { name?: string } | null)?.name === "AbortError") {
            if (tentativaEstourou) {
              estourouTentativa = true; // só esta tentativa; a cadeia segue
              continue;
            }
            break; // busca nova, desmonte ou teto geral
          }
          console.error("Error fetching CEP:", err);
          // Qualquer outra falha (offline, DNS, portal cativo, provedor fora
          // do ar) chega aqui como `TypeError` do próprio `fetch`, ou como
          // `SyntaxError` do `.json()`. Conta como falha DESTE provedor.
        } finally {
          clearTimeout(timerDaTentativa);
          controller.signal.removeEventListener("abort", repassaCancelamento);
        }
      }

      if (superada()) return;

      if (naoExiste === PROVEDORES_DE_CEP.length) {
        // TODOS responderam que não existe: aí sim é CEP errado.
        setResultado({ tipo: "naoEncontrado" });
        if (avisarPorToastRef.current) toast.error("CEP não encontrado");
      } else if (estourouOTeto || estourouTentativa) {
        setResultado({ tipo: "demorou" });
        if (avisarPorToastRef.current) {
          toast.error(
            "A busca de CEP demorou demais. Preencha o endereço manualmente.",
          );
        }
      } else {
        // Sem endereço e sem consenso de "não existe": offline, DNS, portal
        // cativo, todos fora do ar — ou um "não existe" misturado com
        // falha, onde afirmar "CEP não encontrado" seria chute. Sem toast, a
        // cliente só via o spinner parar e concluía — errado — que o CEP
        // não existia.
        setResultado({ tipo: "indisponivel" });
        if (avisarPorToastRef.current) {
          toast.error(
            "Não foi possível buscar o CEP agora. Preencha o endereço manualmente.",
          );
        }
      }
    } finally {
      clearTimeout(timerDoTeto);
      // Só a busca corrente desliga o spinner — uma resposta velha não
      // pode desligar o spinner de uma busca nova.
      if (!superada()) {
        setBuscando(false);
      }
    }
  }, []);

  const limpar = useCallback(() => setResultado(null), []);

  return { buscando, buscar, resultado, limpar };
}
