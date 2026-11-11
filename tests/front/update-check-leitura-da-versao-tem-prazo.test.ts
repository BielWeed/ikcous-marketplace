// A LEITURA DE /version.json TEM PRAZO (r136-f).
//
// O defeito: o portão de atualização lia /version.json com `fetch` sem prazo e
// sem AbortController. Em rede lenta ou conexão pendurada o `await` nunca
// terminava, e três coisas ficavam presas ao mesmo tempo:
//   - a checagem do service worker (`registration.update()` espera a leitura);
//   - a detecção da versão mínima obrigatória (a leitura "da vez" nunca solta
//     o `buscandoParaPurgaRef`, então nenhuma outra é tentada);
//   - a purga obrigatória: `lerVersaoDoServidor` pendura e a tentativa da
//     trava de 2 é gasta sem resposta (o app desiste em silêncio).
//
// POR QUE ESTE TESTE NÃO MONTA O HOOK: `useUpdateCheck.ts` importa
// `virtual:pwa-register/react`, que não resolve neste runner (medido de novo
// nesta peça: o vi.mock com fábrica não impede o vite:import-analysis de
// recusar o import; ver os testes-irmãos). A leitura mora, por isso, numa
// função pura de `@/lib/versao-do-servidor` (`lerVersaoComPrazo`), provada aqui
// com relógio falso; a COLAGEM do hook (usa essa função com o prazo da sonda,
// o `.finally` do ref, o `registration.update()`) é provada por fonte, e o
// efeito sobre a trava é provado rodando o `autorizarPurgaObrigatoria` REAL
// com essa leitura.
//
// Um `fetch` que honra o `signal` (como o de verdade) rejeita com AbortError ao
// ser abortado; é o que `pendurado()` simula.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ehAdiamento } from "@/lib/atualizacao/adiamento";
import { autorizarPurgaObrigatoria } from "@/lib/atualizacao/autorizar-purga";
import { PRAZO_SONDA_DE_REDE_MS } from "@/lib/recuperacao-chunk";
import { lerVersaoComPrazo } from "@/lib/versao-do-servidor";
import { PRAZO_DA_PERGUNTA_MS } from "@/lib/volta-da-manutencao";

const FONTES = import.meta.glob<string>("/src/hooks/useUpdateCheck.ts", {
  query: "?raw",
  import: "default",
  eager: true,
});
const [FONTE_CRUA = ""] = Object.values(FONTES);
const FONTE = FONTE_CRUA.replace(/\s+/g, " ");

function respostaJson(version = "2.0.0-sha.bbb"): Response {
  return new Response(JSON.stringify({ version }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Um fetch que nunca responde, mas rejeita com AbortError se abortado. */
function pendurado() {
  const sinais: AbortSignal[] = [];
  const buscar = vi.fn((_url: unknown, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      const sinal = init?.signal;
      if (sinal) {
        sinais.push(sinal);
        sinal.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }
    });
  });
  return {
    buscar: buscar as unknown as typeof fetch,
    sinais,
    chamadas: buscar,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("controle: o fonte do hook é o certo", () => {
  it("o glob achou o useUpdateCheck", () => {
    expect(Object.keys(FONTES)).toEqual(["/src/hooks/useUpdateCheck.ts"]);
    expect(FONTE).toContain("export function useUpdateCheck");
    expect(FONTE.length).toBeGreaterThan(3000);
  });

  it("o prazo da leitura é o MESMO da sonda de rede (5 s), não outro número", () => {
    expect(PRAZO_SONDA_DE_REDE_MS).toBe(5000);
  });

  it("a pergunta da tela de manutenção usa o MESMO prazo (sem divergir da sonda)", () => {
    expect(PRAZO_DA_PERGUNTA_MS).toBe(PRAZO_SONDA_DE_REDE_MS);
  });
});

describe("lerVersaoComPrazo — fetch que nunca responde", () => {
  it("antes do prazo continua esperando; no prazo ABORTA o pedido e rejeita com AbortError", async () => {
    const { buscar, sinais } = pendurado();
    let desfecho: unknown = "pendente";
    const leitura = lerVersaoComPrazo(PRAZO_SONDA_DE_REDE_MS, buscar).then(
      (v) => {
        desfecho = v;
      },
      (e) => {
        desfecho = e;
      },
    );

    await vi.advanceTimersByTimeAsync(PRAZO_SONDA_DE_REDE_MS - 1);
    expect(desfecho).toBe("pendente");
    expect(sinais[0]?.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await leitura;
    expect(sinais[0]?.aborted).toBe(true);
    expect((desfecho as Error).name).toBe("AbortError");
  });

  it("o corpo que trava DEPOIS dos cabeçalhos também é cortado pelo prazo (o prazo cobre o corpo)", async () => {
    const sinais: AbortSignal[] = [];
    const buscar = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const sinal = init?.signal as AbortSignal;
      sinais.push(sinal);
      const resposta = respostaJson();
      // O corpo só termina se NÃO for abortado: simula o stream pendurado.
      vi.spyOn(resposta, "json").mockImplementation(
        () =>
          new Promise((_r, rejeitar) => {
            sinal.addEventListener("abort", () =>
              rejeitar(new DOMException("aborted", "AbortError")),
            );
          }),
      );
      return resposta;
    }) as unknown as typeof fetch;

    const leitura = lerVersaoComPrazo(PRAZO_SONDA_DE_REDE_MS, buscar);
    await vi.advanceTimersByTimeAsync(PRAZO_SONDA_DE_REDE_MS);
    // O corpo abortado cai no catch da leitura de contrato: sem versão.
    expect(await leitura).toBeNull();
    expect(sinais[0]?.aborted).toBe(true);
  });

  it("pede /version.json sem carimbo, com cache no-store e com o signal do prazo", async () => {
    const buscar = vi.fn(async () => respostaJson());
    await lerVersaoComPrazo(
      PRAZO_SONDA_DE_REDE_MS,
      buscar as unknown as typeof fetch,
    );
    expect(buscar).toHaveBeenCalledWith("/version.json", {
      cache: "no-store",
      signal: expect.any(AbortSignal),
    });
  });
});

describe("lerVersaoComPrazo — controles: o que já funcionava segue igual", () => {
  it("resposta dentro do prazo devolve a versão e não deixa timer pendurado", async () => {
    const buscar = vi.fn(async () => respostaJson("3.1.4-sha.ccc"));
    const lida = await lerVersaoComPrazo(
      PRAZO_SONDA_DE_REDE_MS,
      buscar as unknown as typeof fetch,
    );
    expect(lida).toBe("3.1.4-sha.ccc");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resposta que chega no último instante antes do prazo ainda vale", async () => {
    const buscar = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => resolve(respostaJson("3.1.4")), 4999);
        }),
    );
    const leitura = lerVersaoComPrazo(
      PRAZO_SONDA_DE_REDE_MS,
      buscar as unknown as typeof fetch,
    );
    await vi.advanceTimersByTimeAsync(4999);
    expect(await leitura).toBe("3.1.4");
  });

  it("erro de rede continua sendo erro (o hook o loga e devolve null, como antes) e não deixa timer", async () => {
    const buscar = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      lerVersaoComPrazo(
        PRAZO_SONDA_DE_REDE_MS,
        buscar as unknown as typeof fetch,
      ),
    ).rejects.toThrow("Failed to fetch");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resposta que não é versão legível (HTML de portal cativo) continua null", async () => {
    const buscar = vi.fn(
      async () =>
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    expect(
      await lerVersaoComPrazo(
        PRAZO_SONDA_DE_REDE_MS,
        buscar as unknown as typeof fetch,
      ),
    ).toBeNull();
  });
});

describe("a purga obrigatória com a leitura pendurada: adia e DEVOLVE a tentativa", () => {
  function pedido(buscar: typeof fetch) {
    let trava = { required: "", count: 0 };
    const gravacoes: number[] = [];
    return {
      gravacoes,
      pedido: {
        requerida: "2.0.0",
        versaoLocal: "1.5.0-sha.aaa",
        online: true,
        momentoSeguroAgora: () => true,
        // O MESMO encadeamento do hook: a leitura do contrato com o prazo.
        lerVersaoDoServidor: () =>
          lerVersaoComPrazo(PRAZO_SONDA_DE_REDE_MS, buscar),
        lerTrava: () => trava,
        gravarTrava: (required: string, count: number) => {
          gravacoes.push(count);
          trava = { required, count };
        },
        gravarLog: () => {},
        maximo: 2,
      },
    };
  }

  it("rede pendurada: depois do prazo vira AtualizacaoAdiada e a trava NÃO é gasta; na volta da rede, a tentativa seguinte passa", async () => {
    const { buscar } = pendurado();
    const rodada1 = pedido(buscar);
    let erro: unknown;
    const tentativa = autorizarPurgaObrigatoria(rodada1.pedido).catch((e) => {
      erro = e;
    });
    await vi.advanceTimersByTimeAsync(PRAZO_SONDA_DE_REDE_MS);
    await tentativa;
    expect(ehAdiamento(erro)).toBe(true);
    expect(rodada1.gravacoes).toEqual([]);

    // O ciclo seguinte (rede de volta) lê de novo e a purga é autorizada
    // gastando a PRIMEIRA tentativa — a anterior não foi consumida.
    const rodada2 = pedido(
      vi.fn(async () => respostaJson()) as unknown as typeof fetch,
    );
    await autorizarPurgaObrigatoria(rodada2.pedido);
    expect(rodada2.gravacoes).toEqual([1]);
  });

  it("sem o prazo a promessa ficaria pendente para sempre (o controle que prova o defeito)", async () => {
    const { buscar } = pendurado();
    const semPrazo = pedido(buscar);
    // A leitura antiga, sem signal: o fetch pendurado nunca é abortado.
    semPrazo.pedido.lerVersaoDoServidor = async () => {
      const r = await buscar("/version.json", { cache: "no-store" });
      return (await r.json()) as string;
    };
    let resolvida = false;
    void autorizarPurgaObrigatoria(semPrazo.pedido).then(
      () => {
        resolvida = true;
      },
      () => {
        resolvida = true;
      },
    );
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(resolvida).toBe(false);
  });
});

describe("a colagem do hook (por fonte)", () => {
  const LEITURA = (() => {
    const i = FONTE.indexOf("const lerVersaoDoServidor = useCallback(");
    const j = FONTE.indexOf("const fetchServerVersion = useCallback(", i);
    return i < 0 || j < 0 ? "" : FONTE.slice(i, j);
  })();

  it("controle: achou o corpo da leitura", () => {
    expect(LEITURA).toContain("import.meta.env.DEV");
    expect(LEITURA.length).toBeGreaterThan(300);
  });

  it("a leitura passa pelo contrato COM prazo (o da sonda) e não faz mais fetch cru", () => {
    expect(LEITURA).toContain("lerVersaoComPrazo(PRAZO_SONDA_DE_REDE_MS)");
    expect(LEITURA).not.toContain("fetch(");
    expect(FONTE).toContain("PRAZO_SONDA_DE_REDE_MS,");
  });

  it("erro (inclusive o aborto do prazo) continua virando null com log, nunca lança", () => {
    expect(LEITURA).toContain("catch (e)");
    expect(LEITURA).toContain("Failed to fetch server version");
    expect(LEITURA).toContain("return null;");
  });

  it("a leitura da purga solta o ref no .finally e a da checagem do SW segue para registration.update()", () => {
    expect(FONTE).toContain(
      "void fetchServerVersion().finally(() => { buscandoParaPurgaRef.current = false; });",
    );
    const CHECAGEM_DO_SW = (() => {
      const i = FONTE.indexOf("const checkUpdateNow = async () => {");
      const j = FONTE.indexOf("const intervalId = setInterval(", i);
      return i < 0 || j < 0 ? "" : FONTE.slice(i, j);
    })();
    expect(CHECAGEM_DO_SW).toContain("await fetchServerVersion()");
    expect(CHECAGEM_DO_SW).toContain("registration.update()");
    expect(CHECAGEM_DO_SW.indexOf("await fetchServerVersion()")).toBeLessThan(
      CHECAGEM_DO_SW.indexOf("registration.update()"),
    );
  });
});
