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
 */

// Os quatro campos vêm de `res.json()` (tipado `any`) e o ViaCEP devolve ""
// — ou o campo ausente — quando não tem o dado. `string` puro mentiria para
// o próximo consumidor; os dois chamadores já guardam atrás de `if
// (endereco.logradouro)` etc., então o `undefined` aqui não muda comportamento.
export interface EnderecoDoCep {
  logradouro: string | undefined;
  bairro: string | undefined;
  localidade: string | undefined;
  uf: string | undefined;
}

/** Tempo máximo de espera pela resposta do ViaCEP antes de desistir (#185). */
export const TIMEOUT_BUSCA_CEP_MS = 8000;

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

export function useBuscaCep(aoEncontrar: (endereco: EnderecoDoCep) => void): {
  buscando: boolean;
  buscar: (cepLimpo: string) => Promise<void>;
} {
  const [buscando, setBuscando] = useState(false);

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

    // Distingue timeout de cancelamento por busca nova: uma variável local
    // no closure desta busca, marcada pelo callback do timer antes do
    // `abort()`. Nada de `abort(motivo)` nem `AbortSignal.any` — suporte
    // irregular e recente demais para este projeto.
    let porTimeout = false;
    const timer = setTimeout(() => {
      porTimeout = true;
      controller.abort();
    }, TIMEOUT_BUSCA_CEP_MS);

    setBuscando(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`, {
        signal: controller.signal,
      });

      // Um 500 (ou outro erro HTTP) do ViaCEP costuma vir com corpo HTML —
      // tentar `.json()` nele estoura `SyntaxError` e cai no mesmo buraco
      // mudo do catch. Confere `ok` ANTES de tentar interpretar o corpo.
      // `=== false` e não `!res.ok`: um `Response` de verdade nunca deixa
      // `ok` indefinido, mas os mocks de `use-busca-cep.test.tsx` (e dos
      // outros consumidores do hook: AddressForm e o checkout de convidado)
      // simulam só `{ json }` — tratar "não confirmado bom" como erro
      // quebraria esses testes por um detalhe de mock, não por um defeito
      // real. Ver relatório do item 2 (bloqueio de 26/08/2026): `!res.ok`
      // quebra 7 arquivos de teste fora do escopo daquela correção.
      if (res.ok === false) {
        if (sequencia !== sequenciaRef.current || desmontadoRef.current) {
          return;
        }
        toast.error(
          "Não foi possível buscar o CEP agora. Preencha o endereço manualmente.",
        );
        return;
      }

      const data = await res.json();

      // Uma busca mais nova já começou enquanto esta estava em voo, ou o
      // componente já desmontou — a resposta chegou velha, descarta sem
      // tocar no formulário nem emitir toast.
      if (sequencia !== sequenciaRef.current || desmontadoRef.current) return;

      if (data && !data.erro) {
        aoEncontrarRef.current({
          logradouro: data.logradouro,
          bairro: data.bairro,
          localidade: data.localidade,
          uf: data.uf,
        });
        toast.success("CEP localizado!");
      } else {
        toast.error("CEP não encontrado");
      }
    } catch (err) {
      // Cancelamento (nova busca assumiu ou componente desmontou) — não é
      // erro, não loga. Confere por `name`, nunca por `instanceof
      // DOMException`: em jsdom o `AbortError` vem de outro realm e o
      // `instanceof` dá `false`, jogando um cancelamento legítimo no
      // `console.error`.
      if ((err as { name?: string } | null)?.name === "AbortError") {
        if (
          porTimeout &&
          sequencia === sequenciaRef.current &&
          !desmontadoRef.current
        ) {
          toast.error(
            "A busca de CEP demorou demais. Preencha o endereço manualmente.",
          );
        }
        return;
      }
      console.error("Error fetching CEP:", err);
      // Qualquer outra falha (offline, DNS, portal cativo, ViaCEP fora do
      // ar) chega aqui como `TypeError` do próprio `fetch`. Sem toast, a
      // cliente só via o spinner parar e concluía — errado — que o CEP não
      // existia.
      if (sequencia === sequenciaRef.current && !desmontadoRef.current) {
        toast.error(
          "Não foi possível buscar o CEP agora. Preencha o endereço manualmente.",
        );
      }
    } finally {
      clearTimeout(timer);
      // Só a busca corrente desliga o spinner — uma resposta velha não
      // pode desligar o spinner de uma busca nova.
      if (sequencia === sequenciaRef.current && !desmontadoRef.current) {
        setBuscando(false);
      }
    }
  }, []);

  return { buscando, buscar };
}
