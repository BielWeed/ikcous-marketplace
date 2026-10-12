import { vi } from "vitest";

/**
 * Dublê de `fetch` para os testes do checkout de CONVIDADO cujo assunto NÃO é
 * a busca de CEP.
 *
 * Desde o PR #761 a busca roda em toda loja, também a de entrega local: quem
 * digita um CEP de 8 dígitos dispara consultas a provedores públicos (ViaCEP,
 * OpenCEP, AwesomeAPI). Sem dublê, o teste de unidade vai à rede de verdade —
 * e a resposta chega numa hora que o teste não controla (no CI do Linux chegou
 * DEPOIS de o teste digitar a cidade e a apagou).
 *
 * Este dublê NUNCA responde: a busca fica em voo enquanto o teste dura. Assim
 * nenhum campo é preenchido e nenhum toast sai ("CEP localizado", "CEP não
 * encontrado") — o mesmo cenário de antes do #761, em que a loja local não
 * buscava, e sem sujar os testes que contam chamadas de `toast.error`. Honra o
 * `AbortSignal` como o `fetch` de verdade: o desmonte da tela (fim do teste) e
 * o tempo da tentativa cancelam a espera, sem timer nem promessa pendurada.
 *
 * Quem quer provar a busca em si (resposta preenchendo, corrida contra a
 * digitação) monta o próprio dublê, como em checkout-guest-cep.test.tsx e
 * checkout-guest-cep-nao-sobrescreve-o-que-o-cliente-digitou.test.tsx.
 *
 * Instala com `vi.stubGlobal`: o `vi.unstubAllGlobals()` do afterEach desfaz.
 */
export function pararABuscaDeCep(): ReturnType<typeof vi.fn> {
  const fetchSemResposta = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" })),
        );
      }),
  );
  vi.stubGlobal("fetch", fetchSemResposta);
  return fetchSemResposta;
}
