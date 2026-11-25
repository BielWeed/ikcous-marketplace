// @vitest-environment jsdom
//
// `useMototaxi` (o contato do mototaxi que a lojista configura em Frete) direto
// no hook, nos limites que as telas não mostram:
//  - salvar NUNCA manda ao banco número que não é telefone (apagaria o contato
//    em vez de recusar), nem nome com mais de 80 letras; número em branco é
//    permitido e grava "sem número";
//  - o que o banco devolve tem de bater com o que foi enviado, senão não vale;
//  - sem resposta em 20 s o erro com a frase pronta sobe para a tela;
//  - a leitura VELHA (a tela pediu outra) não sobrescreve nem o contato nem o erro.
// Números inventados.
import { useMototaxi } from "@/hooks/useMototaxi";
import {
  MENSAGEM_MOTOTAXI_SEM_RESPOSTA,
  ehConsultaSemResposta,
} from "@/lib/prazo-da-requisicao";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Resposta {
  data: unknown;
  error: unknown;
}

const banco = vi.hoisted(() => ({
  leituras: 0,
  proximasLeituras: [] as Array<() => Promise<Resposta>>,
  padraoDaLeitura: { data: null, error: null } as Resposta,
  rpcs: [] as Array<{ nome: string; args: Record<string, unknown> }>,
  proximasRpcs: [] as Array<() => Promise<Resposta>>,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: (colunas: string) => ({
        eq: (coluna: string, valor: number) => ({
          maybeSingle: () => {
            expect([tabela, colunas, coluna, valor]).toEqual([
              "config_mototaxi",
              "whatsapp,nome",
              "id",
              1,
            ]);
            banco.leituras += 1;
            const proxima = banco.proximasLeituras.shift();
            return proxima ? proxima() : Promise.resolve(banco.padraoDaLeitura);
          },
        }),
      }),
    }),
    rpc: (nome: string, args: Record<string, unknown>) => {
      banco.rpcs.push({ nome, args });
      const proxima = banco.proximasRpcs.shift();
      return proxima ? proxima() : Promise.resolve({ data: null, error: null });
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Visto = ReturnType<typeof useMototaxi>;
let ultimo: Visto;
function Sonda({ sinal }: { sinal?: boolean }) {
  const valor = useMototaxi(sinal);
  useEffect(() => {
    ultimo = valor;
  });
  return null;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
async function renderizar(sinal?: boolean) {
  await act(async () => {
    raiz.render(<Sonda sinal={sinal} />);
  });
}
async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function adiada() {
  let resolver!: (r: Resposta) => void;
  let rejeitar!: (e: Error) => void;
  const promessa = new Promise<Resposta>((res, rej) => {
    resolver = res;
    rejeitar = rej;
  });
  return { promessa, resolver, rejeitar };
}
const NUMERO_BONITO = "(11) 98765-4321";
const NUMERO_GRAVADO = "5511987654321";
const ok = (whatsapp: string | null, nome: string | null): Resposta => ({
  data: { whatsapp, nome },
  error: null,
});

beforeEach(() => {
  vi.useFakeTimers();
  banco.leituras = 0;
  banco.proximasLeituras = [];
  banco.padraoDaLeitura = { data: null, error: null };
  banco.rpcs = [];
  banco.proximasRpcs = [];
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(async () => {
  await act(async () => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

describe("useMototaxi — leitura", () => {
  it("lê o contato gravado; linha ausente vira 'sem número, sem nome' (e não erro)", async () => {
    banco.padraoDaLeitura = { data: null, error: null };
    await renderizar();
    expect(ultimo.config).toEqual({ whatsapp: null, nome: null });
    expect(ultimo.erro).toBe(false);
  });

  it("leitura com erro: sem contato e com erro; 'recarregar' lê de novo e limpa o erro", async () => {
    banco.proximasLeituras.push(() =>
      Promise.resolve({ data: null, error: new Error("rede") }),
    );
    await renderizar();
    expect(ultimo.config).toBeNull();
    expect(ultimo.erro).toBe(true);

    banco.padraoDaLeitura = ok(NUMERO_GRAVADO, "Zé");
    await act(async () => {
      ultimo.recarregar();
    });
    expect(banco.leituras).toBe(2);
    expect(ultimo.config).toEqual({ whatsapp: NUMERO_GRAVADO, nome: "Zé" });
    expect(ultimo.erro).toBe(false);
  });

  it("o sinal de releitura só lê de novo quando MUDA", async () => {
    await renderizar(false);
    expect(banco.leituras).toBe(1);
    await renderizar(false);
    expect(banco.leituras).toBe(1);
    await renderizar(true);
    expect(banco.leituras).toBe(2);
  });

  it("o ERRO de uma leitura velha, chegando depois, não derruba o contato da leitura nova", async () => {
    const velha = adiada();
    banco.proximasLeituras.push(() => velha.promessa);
    banco.padraoDaLeitura = ok(NUMERO_GRAVADO, "Zé");
    await renderizar(false);
    await renderizar(true);
    expect(ultimo.config).toEqual({ whatsapp: NUMERO_GRAVADO, nome: "Zé" });

    await act(async () => {
      velha.rejeitar(new Error("caiu tarde demais"));
      await velha.promessa.catch(() => undefined);
    });
    expect(ultimo.erro).toBe(false);
    expect(ultimo.config).toEqual({ whatsapp: NUMERO_GRAVADO, nome: "Zé" });
  });

  it("o contato de uma leitura velha, chegando depois, não sobrescreve o da leitura nova", async () => {
    const velha = adiada();
    banco.proximasLeituras.push(() => velha.promessa);
    banco.padraoDaLeitura = ok(NUMERO_GRAVADO, "Novo");
    await renderizar(false);
    await renderizar(true);

    await act(async () => {
      velha.resolver(ok("5521999998888", "Velho"));
      await velha.promessa;
    });
    expect(ultimo.config).toEqual({ whatsapp: NUMERO_GRAVADO, nome: "Novo" });
  });
});

describe("useMototaxi — salvar", () => {
  async function salvar(whatsapp: string | null, nome: string | null) {
    let resultado: boolean | undefined;
    await act(async () => {
      resultado = await ultimo.salvar({ whatsapp, nome });
    });
    return resultado;
  }

  it("número que não é telefone: recusa e NÃO manda nada ao banco", async () => {
    await renderizar();
    expect(await salvar("12345", "Zé")).toBe(false);
    expect(await salvar("abc", "Zé")).toBe(false);
    expect(banco.rpcs).toEqual([]);
  });

  it("nome com 81 letras: recusa sem mandar ao banco; com 80, grava", async () => {
    await renderizar();
    expect(await salvar(NUMERO_BONITO, "a".repeat(81))).toBe(false);
    expect(banco.rpcs).toEqual([]);

    banco.proximasRpcs.push(() =>
      Promise.resolve(ok(NUMERO_GRAVADO, "a".repeat(80))),
    );
    expect(await salvar(NUMERO_BONITO, "a".repeat(80))).toBe(true);
    expect(banco.rpcs).toEqual([
      {
        nome: "salvar_config_mototaxi",
        args: { p_whatsapp: NUMERO_GRAVADO, p_nome: "a".repeat(80) },
      },
    ]);
  });

  it("grava o número normalizado e o nome sem espaços nas pontas, e atualiza o contato da tela", async () => {
    await renderizar();
    banco.proximasRpcs.push(() =>
      Promise.resolve(ok(NUMERO_GRAVADO, "Zé da moto")),
    );
    expect(await salvar(NUMERO_BONITO, "  Zé da moto  ")).toBe(true);
    expect(banco.rpcs[0]?.args).toEqual({
      p_whatsapp: NUMERO_GRAVADO,
      p_nome: "Zé da moto",
    });
    expect(ultimo.config).toEqual({
      whatsapp: NUMERO_GRAVADO,
      nome: "Zé da moto",
    });
    expect(ultimo.erro).toBe(false);
  });

  it("depois de uma leitura com erro, salvar com sucesso limpa o erro e mostra o contato gravado", async () => {
    banco.proximasLeituras.push(() =>
      Promise.resolve({ data: null, error: new Error("rede") }),
    );
    await renderizar();
    expect(ultimo.erro).toBe(true);
    expect(ultimo.config).toBeNull();

    banco.proximasRpcs.push(() => Promise.resolve(ok(NUMERO_GRAVADO, "Zé")));
    expect(await salvar(NUMERO_BONITO, "Zé")).toBe(true);
    expect(ultimo.erro).toBe(false);
    expect(ultimo.config).toEqual({ whatsapp: NUMERO_GRAVADO, nome: "Zé" });
  });

  it("número em branco é permitido: grava 'sem número' e nome em branco vira sem nome", async () => {
    await renderizar();
    banco.proximasRpcs.push(() => Promise.resolve(ok(null, null)));
    expect(await salvar("   ", "   ")).toBe(true);
    expect(banco.rpcs[0]?.args).toEqual({ p_whatsapp: null, p_nome: null });
    expect(ultimo.config).toEqual({ whatsapp: null, nome: null });
  });

  it.each([
    [
      "erro do banco",
      { data: ok(NUMERO_GRAVADO, "Zé").data, error: new Error("x") },
    ],
    ["sem dados", { data: null, error: null }],
    ["lista no lugar de objeto", { data: [], error: null }],
    ["outro número do que foi enviado", ok("5521999998888", "Zé")],
    ["outro nome do que foi enviado", ok(NUMERO_GRAVADO, "Outro")],
  ] as Array<[string, Resposta]>)(
    "resposta que não confere (%s): não vale e a tela não muda",
    async (_nome, resposta) => {
      banco.padraoDaLeitura = ok("5531988887777", "Antigo");
      await renderizar();
      banco.proximasRpcs.push(() => Promise.resolve(resposta));
      expect(await salvar(NUMERO_BONITO, "Zé")).toBe(false);
      expect(ultimo.config).toEqual({
        whatsapp: "5531988887777",
        nome: "Antigo",
      });
    },
  );

  it("sem resposta: espera 19,999 s e só aos 20 s sobe o erro com a frase pronta", async () => {
    await renderizar();
    banco.proximasRpcs.push(() => new Promise<Resposta>(() => {}));
    let situacao: "pendente" | "subiu" | "voltou" = "pendente";
    let falha: unknown;
    void ultimo.salvar({ whatsapp: NUMERO_BONITO, nome: "Zé" }).then(
      () => {
        situacao = "voltou";
      },
      (erro: unknown) => {
        situacao = "subiu";
        falha = erro;
      },
    );
    await passar(19_999);
    expect(situacao).toBe("pendente");
    await passar(1);
    expect(situacao).toBe("subiu");
    expect(ehConsultaSemResposta(falha)).toBe(true);
    expect((falha as Error).message).toBe(MENSAGEM_MOTOTAXI_SEM_RESPOSTA);
  });

  it("exceção que não é de prazo (rede caiu) vira 'false', sem subir", async () => {
    await renderizar();
    banco.proximasRpcs.push(() => Promise.reject(new Error("caiu")));
    expect(await salvar(NUMERO_BONITO, "Zé")).toBe(false);
  });
});
