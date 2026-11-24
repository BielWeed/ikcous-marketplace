// @vitest-environment jsdom
//
// O hook que lê a política de trocas que a lojista gravou. A cliente vê as
// regras ANTES de comprar, então o que o hook promete tem de ser exato:
//   - só consulta o banco quando alguém está olhando (`ativo`);
//   - falha de rede, linha ausente, resposta com erro e resposta torta viram
//     "indisponivel" — NUNCA "a loja não tem política" e nunca prazo inventado;
//   - rede pendurada (conecta e não responde) estoura em 12 s e vira
//     "indisponivel", e `tentarDeNovo` lê outra vez;
//   - resposta ANTIGA que chega depois de uma releitura não sobrescreve a nova.
// `politicas-pagina.test.tsx` cobre a tela inteira com o caminho feliz e uma
// falha; os limites abaixo só se enxergam chamando o hook direto.
import { act, createElement, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COLUNAS_DA_POLITICA } from "@/lib/devolucao";
import { PRAZO_DA_CONSULTA_DO_CHECKOUT_MS } from "@/lib/prazo-da-requisicao";

type Leitura = { data: unknown; error: unknown };

const h = vi.hoisted(() => ({
  // Cada consulta ao banco tira UMA função desta fila; sem nada na fila,
  // devolve `padrao`.
  fila: [] as Array<() => Promise<unknown>>,
  padrao: null as unknown,
  consultas: [] as Array<{
    tabela: string;
    colunas: string;
    filtro: unknown[];
  }>,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      const consulta = { tabela, colunas: "", filtro: [] as unknown[] };
      h.consultas.push(consulta);
      const cadeia = {
        select: (colunas: string) => {
          consulta.colunas = colunas;
          return cadeia;
        },
        eq: (...args: unknown[]) => {
          consulta.filtro = args;
          return cadeia;
        },
        maybeSingle: () => {
          const proxima = h.fila.shift();
          return proxima ? proxima() : Promise.resolve(h.padrao);
        },
      };
      return cadeia;
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import {
  type EstadoDaPoliticaDeTrocas,
  usePoliticaDeTrocasDaLoja,
} from "@/hooks/usePoliticaDeTrocasDaLoja";

type Visto = EstadoDaPoliticaDeTrocas & { tentarDeNovo: () => void };

function linha(sobrescreve: Record<string, unknown> = {}) {
  return {
    prazo_arrependimento_dias: 7,
    prazo_troca_dias: 30,
    prazo_vicio_dias: 90,
    aceita_troca: true,
    aceita_vale: false,
    exige_fotos_vicio: true,
    metodos_locais: ["entrega_na_loja"],
    metodos_nacionais: ["envio_proprio"],
    reembolso_momento: "ao_receber",
    frete_troca_pago_por: "cliente",
    categorias_sem_troca: [],
    texto_politica: "",
    endereco_devolucao: "",
    updated_at: null,
    ...sobrescreve,
  };
}

const ok = (dados: unknown): Leitura => ({ data: dados, error: null });

function adiada() {
  let resolver!: (v: unknown) => void;
  const promessa = new Promise<unknown>((r) => {
    resolver = r;
  });
  return { promessa, resolver };
}

describe("usePoliticaDeTrocasDaLoja — estados e limites", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ultimo: Visto;

  function Sonda({ ativo }: { ativo: boolean }) {
    const visto = usePoliticaDeTrocasDaLoja(ativo);
    useEffect(() => {
      ultimo = visto;
    });
    return null;
  }

  async function montar(ativo: boolean) {
    await act(async () => {
      raiz.render(createElement(Sonda, { ativo }));
    });
  }
  async function reRenderizar(ativo: boolean) {
    await act(async () => {
      raiz.render(createElement(Sonda, { ativo }));
    });
  }
  async function assentar() {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    h.fila = [];
    h.padrao = ok(linha());
    h.consultas = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.useRealTimers();
  });

  it("inativo: não consulta o banco e fica em 'carregando' sem política", async () => {
    await montar(false);
    await assentar();
    expect(h.consultas).toHaveLength(0);
    expect(ultimo.estado).toBe("carregando");
    expect(ultimo.politica).toBeNull();
  });

  it("ativo: lê a linha única da política com as colunas certas e entrega os prazos gravados", async () => {
    h.padrao = ok(linha({ prazo_troca_dias: 45, aceita_vale: true }));
    await montar(true);
    await assentar();
    expect(h.consultas).toEqual([
      {
        tabela: "politica_devolucao",
        colunas: COLUNAS_DA_POLITICA,
        filtro: ["id", 1],
      },
    ]);
    expect(ultimo.estado).toBe("pronto");
    expect(ultimo.politica?.prazo_troca_dias).toBe(45);
    expect(ultimo.politica?.aceita_vale).toBe(true);
  });

  it("começa em 'carregando' e só vira 'pronto' quando a resposta chega", async () => {
    const espera = adiada();
    h.fila.push(() => espera.promessa);
    await montar(true);
    await assentar();
    expect(ultimo.estado).toBe("carregando");
    expect(ultimo.politica).toBeNull();
    await act(async () => {
      espera.resolver(ok(linha()));
      await espera.promessa;
    });
    expect(ultimo.estado).toBe("pronto");
  });

  it("resposta com ERRO vira 'indisponivel', mesmo que traga dados junto (nunca prazo de uma leitura falha)", async () => {
    h.padrao = {
      data: linha({ prazo_troca_dias: 3 }),
      error: new Error("rls"),
    };
    await montar(true);
    await assentar();
    expect(ultimo.estado).toBe("indisponivel");
    expect(ultimo.politica).toBeNull();
  });

  it("linha ausente (banco sem a política) vira 'indisponivel', não 'a loja não tem regras'", async () => {
    h.padrao = ok(null);
    await montar(true);
    await assentar();
    expect(ultimo.estado).toBe("indisponivel");
    expect(ultimo.politica).toBeNull();
  });

  it("resposta torta (prazo faltando ou em texto) vira 'indisponivel', sem inventar prazo", async () => {
    h.padrao = ok({ ...linha(), prazo_troca_dias: undefined });
    await montar(true);
    await assentar();
    expect(ultimo.estado).toBe("indisponivel");
    expect(ultimo.politica).toBeNull();
  });

  it("consulta que levanta exceção vira 'indisponivel' e não derruba a tela", async () => {
    h.fila.push(() => Promise.reject(new Error("rede caiu")));
    await montar(true);
    await assentar();
    expect(ultimo.estado).toBe("indisponivel");
  });

  it("rede pendurada: segue 'carregando' até o prazo e estoura em 'indisponivel'", async () => {
    vi.useFakeTimers();
    h.fila.push(() => new Promise(() => {}));
    await montar(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PRAZO_DA_CONSULTA_DO_CHECKOUT_MS - 1);
    });
    expect(ultimo.estado).toBe("carregando");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(ultimo.estado).toBe("indisponivel");
    expect(ultimo.politica).toBeNull();
  });

  it("tentarDeNovo: volta a 'carregando', lê outra vez e entrega a política nova", async () => {
    h.fila.push(() =>
      Promise.resolve({ data: null, error: new Error("rede") }),
    );
    await montar(true);
    await assentar();
    expect(ultimo.estado).toBe("indisponivel");
    expect(h.consultas).toHaveLength(1);

    const segunda = adiada();
    h.fila.push(() => segunda.promessa);
    await act(async () => {
      ultimo.tentarDeNovo();
    });
    expect(h.consultas).toHaveLength(2);
    expect(ultimo.estado).toBe("carregando");
    await act(async () => {
      segunda.resolver(ok(linha({ prazo_vicio_dias: 120 })));
      await segunda.promessa;
    });
    expect(ultimo.estado).toBe("pronto");
    expect(ultimo.politica?.prazo_vicio_dias).toBe(120);
  });

  it("resposta ANTIGA que chega depois da releitura não sobrescreve a política nova", async () => {
    const velha = adiada();
    const nova = adiada();
    h.fila.push(
      () => velha.promessa,
      () => nova.promessa,
    );
    await montar(true);
    await assentar();
    await act(async () => {
      ultimo.tentarDeNovo();
    });
    expect(h.consultas).toHaveLength(2);

    await act(async () => {
      nova.resolver(ok(linha({ prazo_troca_dias: 60 })));
      await nova.promessa;
    });
    expect(ultimo.politica?.prazo_troca_dias).toBe(60);

    await act(async () => {
      velha.resolver(ok(linha({ prazo_troca_dias: 5 })));
      await velha.promessa;
    });
    expect(ultimo.estado).toBe("pronto");
    expect(ultimo.politica?.prazo_troca_dias).toBe(60);
  });

  it("falha ANTIGA que chega depois da política nova também não a derruba", async () => {
    const velha = adiada();
    h.fila.push(() => velha.promessa);
    await montar(true);
    await assentar();
    h.padrao = ok(linha({ prazo_troca_dias: 60 }));
    await act(async () => {
      ultimo.tentarDeNovo();
    });
    await assentar();
    expect(ultimo.politica?.prazo_troca_dias).toBe(60);

    await act(async () => {
      velha.resolver({ data: null, error: new Error("tarde demais") });
      await velha.promessa;
    });
    expect(ultimo.estado).toBe("pronto");
    expect(ultimo.politica?.prazo_troca_dias).toBe(60);
  });

  it("exceção ANTIGA (rede caiu) que estoura depois da política nova também não a derruba", async () => {
    let estourar!: (motivo: Error) => void;
    const velha = new Promise<unknown>((_, rejeitar) => {
      estourar = rejeitar;
    });
    h.fila.push(() => velha);
    await montar(true);
    await assentar();
    h.padrao = ok(linha({ prazo_troca_dias: 60 }));
    await act(async () => {
      ultimo.tentarDeNovo();
    });
    await assentar();
    expect(ultimo.politica?.prazo_troca_dias).toBe(60);

    await act(async () => {
      estourar(new Error("caiu tarde demais"));
      await velha.catch(() => undefined);
    });
    expect(ultimo.estado).toBe("pronto");
    expect(ultimo.politica?.prazo_troca_dias).toBe(60);
  });

  it("exceção que chega depois de a tela fechar não muda o estado", async () => {
    let estourar!: (motivo: Error) => void;
    const velha = new Promise<unknown>((_, rejeitar) => {
      estourar = rejeitar;
    });
    h.fila.push(() => velha);
    await montar(true);
    await assentar();
    await reRenderizar(false);
    await act(async () => {
      estourar(new Error("caiu depois de fechar"));
      await velha.catch(() => undefined);
    });
    expect(ultimo.estado).toBe("carregando");
    expect(ultimo.politica).toBeNull();
  });

  it("resposta que chega depois de a tela fechar não muda o estado", async () => {
    const espera = adiada();
    h.fila.push(() => espera.promessa);
    await montar(true);
    await assentar();
    await reRenderizar(false);
    await act(async () => {
      espera.resolver(ok(linha()));
      await espera.promessa;
    });
    expect(ultimo.estado).not.toBe("pronto");
    expect(ultimo.politica).toBeNull();
  });

  it("reabrir a tela lê de novo (inativo → ativo dispara nova consulta)", async () => {
    await montar(false);
    await assentar();
    expect(h.consultas).toHaveLength(0);
    await reRenderizar(true);
    await assentar();
    expect(h.consultas).toHaveLength(1);
    expect(ultimo.estado).toBe("pronto");
  });
});
