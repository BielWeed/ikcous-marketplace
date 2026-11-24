// @vitest-environment jsdom
//
// O contrato do hook `usePedidosDePrivacidade` (src/hooks/usePedidosDePrivacidade.ts) nos limites que a tela
// sozinha não mostra: o pedido de EXCLUSÃO nunca leva e-mail (mesmo que alguém passe um), sem conta logada
// nada vai ao banco, o toque duplo vale um pedido só e a trava solta depois, e a releitura só acontece quando
// ela é a resposta certa (pedido duplicado, resposta ilegível, prazo estourado) — erro de rede comum não relê.
// Dados inventados (*.invalid): nenhum dado real de cliente.
import { usePedidosDePrivacidade } from "@/hooks/usePedidosDePrivacidade";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const USER = "cliente-hook-1";

interface Resposta {
  data: unknown;
  error: unknown;
}

const banco = vi.hoisted(() => ({
  leituras: 0,
  inserts: [] as Array<Record<string, unknown>>,
  lista: { data: [], error: null } as Resposta,
  // Resposta própria de uma conta (promessa que o teste controla), pelo `user_id` consultado.
  respostaDaConta: new Map<string, () => Promise<Resposta>>(),
  // Cada chamada de insert consome a próxima função daqui (ou resolve `padrao`).
  proximasInsercoes: [] as Array<() => Promise<Resposta>>,
  padrao: { data: null, error: null } as Resposta,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (_coluna: string, conta: string) => ({
          order: async () => {
            banco.leituras += 1;
            // Leitura de uma conta com resposta guardada (o teste solta quando quiser).
            const guardada = banco.respostaDaConta.get(conta);
            if (guardada) return guardada();
            return banco.lista;
          },
        }),
      }),
      insert: (linha: Record<string, unknown>) => {
        banco.inserts.push(linha);
        return {
          select: () => ({
            single: () => {
              const proxima = banco.proximasInsercoes.shift();
              return proxima ? proxima() : Promise.resolve(banco.padrao);
            },
          }),
        };
      },
    }),
  },
}));

function linhaDoBanco(extra: Record<string, unknown> = {}) {
  return {
    id: "ped-1",
    user_id: USER,
    tipo: "excluir_conta",
    email_novo: null,
    situacao: "aberto",
    criado_em: "2026-11-01T12:00:00Z",
    atendido_em: null,
    observacao: null,
    ...extra,
  };
}

let atual: ReturnType<typeof usePedidosDePrivacidade>;
function Sonda({ userId }: { userId: string | null }) {
  const hook = usePedidosDePrivacidade(userId);
  useEffect(() => {
    atual = hook;
  }, [hook]);
  return <output>{hook.carga}</output>;
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

async function assentar() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

async function montar(userId: string | null = USER) {
  act(() => {
    raiz.render(<Sonda userId={userId} />);
  });
  await assentar();
}

beforeEach(() => {
  banco.leituras = 0;
  banco.inserts = [];
  banco.lista = { data: [], error: null };
  banco.respostaDaConta = new Map();
  banco.proximasInsercoes = [];
  banco.padrao = { data: null, error: null };
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("usePedidosDePrivacidade: o que vai ao banco", () => {
  it("pedido de EXCLUSÃO nunca leva e-mail, mesmo se alguém passar um", async () => {
    banco.padrao = { data: linhaDoBanco(), error: null };
    await montar();
    await act(async () => {
      await atual.pedir("excluir_conta", "intruso@exemplo.invalid");
    });
    expect(banco.inserts).toEqual([
      { user_id: USER, tipo: "excluir_conta", email_novo: null },
    ]);
  });

  it("pedido de e-mail leva o e-mail como veio; sem e-mail vai null (nunca undefined)", async () => {
    banco.padrao = {
      data: linhaDoBanco({
        id: "ped-2",
        tipo: "corrigir_email",
        email_novo: "novo@exemplo.invalid",
      }),
      error: null,
    };
    await montar();
    await act(async () => {
      await atual.pedir("corrigir_email", "novo@exemplo.invalid");
    });
    await act(async () => {
      await atual.pedir("corrigir_email");
    });
    expect(banco.inserts).toEqual([
      {
        user_id: USER,
        tipo: "corrigir_email",
        email_novo: "novo@exemplo.invalid",
      },
      { user_id: USER, tipo: "corrigir_email", email_novo: null },
    ]);
  });
});

describe("usePedidosDePrivacidade: sem conta logada", () => {
  it("não consulta o banco, fica em 'carregando' e recusa o pedido sem gravar nada", async () => {
    await montar(null);
    expect(banco.leituras).toBe(0);
    expect(atual.carga).toBe("carregando");
    let resultado: Awaited<ReturnType<typeof atual.pedir>> | undefined;
    await act(async () => {
      resultado = await atual.pedir("excluir_conta");
    });
    expect(resultado).toEqual({ ok: false, falha: "sem_sessao" });
    expect(banco.inserts).toHaveLength(0);
    await act(async () => {
      await atual.recarregar();
    });
    expect(banco.leituras).toBe(0);
  });
});

describe("usePedidosDePrivacidade: toque duplo", () => {
  it("o segundo toque com o primeiro em voo não grava de novo; solto o primeiro, um novo pedido passa", async () => {
    let soltar!: (r: Resposta) => void;
    banco.proximasInsercoes.push(
      () =>
        new Promise<Resposta>((resolve) => {
          soltar = resolve;
        }),
    );
    await montar();

    let primeiro: Promise<unknown> | undefined;
    act(() => {
      primeiro = atual.pedir("excluir_conta");
    });
    expect(atual.enviando).toBe("excluir_conta");

    let segundo: Awaited<ReturnType<typeof atual.pedir>> | undefined;
    await act(async () => {
      segundo = await atual.pedir("excluir_conta");
    });
    expect(segundo).toEqual({ ok: false, falha: "ja_existe" });
    expect(banco.inserts).toHaveLength(1);

    await act(async () => {
      soltar({ data: linhaDoBanco(), error: null });
      await primeiro;
    });
    expect(atual.enviando).toBeNull();

    // A trava foi solta: uma nova chamada chega ao banco.
    banco.padrao = {
      data: linhaDoBanco({ id: "ped-9", criado_em: "2026-11-02T12:00:00Z" }),
      error: null,
    };
    await act(async () => {
      await atual.pedir("excluir_conta");
    });
    expect(banco.inserts).toHaveLength(2);
  });

  it("a trava também solta depois de uma FALHA (a cliente pode tentar de novo)", async () => {
    banco.proximasInsercoes.push(() =>
      Promise.resolve({ data: null, error: { code: "40001", message: "x" } }),
    );
    await montar();
    await act(async () => {
      await atual.pedir("excluir_conta");
    });
    expect(atual.enviando).toBeNull();
    banco.padrao = { data: linhaDoBanco(), error: null };
    await act(async () => {
      await atual.pedir("excluir_conta");
    });
    expect(banco.inserts).toHaveLength(2);
  });
});

describe("usePedidosDePrivacidade: quando relê a lista depois de uma falha", () => {
  it("pedido duplicado (23505) relê UMA vez e devolve 'ja_existe'", async () => {
    banco.padrao = { data: null, error: { code: "23505", message: "dup" } };
    await montar();
    expect(banco.leituras).toBe(1);
    let resultado: Awaited<ReturnType<typeof atual.pedir>> | undefined;
    await act(async () => {
      resultado = await atual.pedir("excluir_conta");
    });
    expect(resultado).toEqual({ ok: false, falha: "ja_existe" });
    expect(banco.leituras).toBe(2);
  });

  it("outro erro do banco (código desconhecido) NÃO relê e devolve 'outra'", async () => {
    banco.padrao = { data: null, error: { code: "40001", message: "x" } };
    await montar();
    let resultado: Awaited<ReturnType<typeof atual.pedir>> | undefined;
    await act(async () => {
      resultado = await atual.pedir("excluir_conta");
    });
    expect(resultado).toEqual({ ok: false, falha: "outra" });
    expect(banco.leituras).toBe(1);
  });

  it("rede caiu no meio (TypeError de fetch) NÃO relê: só o prazo estourado relê", async () => {
    banco.proximasInsercoes.push(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    await montar();
    let resultado: Awaited<ReturnType<typeof atual.pedir>> | undefined;
    await act(async () => {
      resultado = await atual.pedir("excluir_conta");
    });
    expect(resultado).toEqual({ ok: false, falha: "sem_rede" });
    expect(banco.leituras).toBe(1);
  });

  it("sessão vencida (42501) devolve 'sem_sessao' sem reler", async () => {
    banco.padrao = { data: null, error: { code: "42501", message: "rls" } };
    await montar();
    let resultado: Awaited<ReturnType<typeof atual.pedir>> | undefined;
    await act(async () => {
      resultado = await atual.pedir("excluir_conta");
    });
    expect(resultado).toEqual({ ok: false, falha: "sem_sessao" });
    expect(banco.leituras).toBe(1);
  });

  it("gravou mas a resposta veio ilegível: relê e devolve 'outra' (nunca finge sucesso)", async () => {
    banco.padrao = { data: { id: 5, tipo: "apagar_tudo" }, error: null };
    await montar();
    let resultado: Awaited<ReturnType<typeof atual.pedir>> | undefined;
    await act(async () => {
      resultado = await atual.pedir("excluir_conta");
    });
    expect(resultado).toEqual({ ok: false, falha: "outra" });
    expect(banco.leituras).toBe(2);
  });

  it("prazo de 15 s estourado: relê para ver se gravou e devolve 'sem_rede'", async () => {
    banco.proximasInsercoes.push(() => new Promise<Resposta>(() => {}));
    await montar();
    // O relógio falso só entra depois da montagem: o prazo do pedido nasce no `pedir`.
    vi.useFakeTimers();
    let resultado: Awaited<ReturnType<typeof atual.pedir>> | undefined;
    let pendente: Promise<unknown> | undefined;
    act(() => {
      pendente = atual.pedir("excluir_conta").then((r) => {
        resultado = r;
      });
    });
    // 1 ms antes do prazo ainda está esperando.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(14_999);
    });
    expect(resultado).toBeUndefined();
    expect(atual.enviando).toBe("excluir_conta");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
      await pendente;
    });
    expect(resultado).toEqual({ ok: false, falha: "sem_rede" });
    expect(banco.leituras).toBe(2);
    expect(atual.enviando).toBeNull();
  });
});

describe("usePedidosDePrivacidade: a lista depois de um pedido novo", () => {
  it("o pedido novo vai para o TOPO da lista, na frente do que já estava lá", async () => {
    banco.lista = {
      data: [linhaDoBanco({ id: "velho", criado_em: "2026-09-01T12:00:00Z" })],
      error: null,
    };
    await montar();
    expect(atual.pedidos.map((p) => p.id)).toEqual(["velho"]);
    banco.padrao = {
      data: linhaDoBanco({ id: "novo", criado_em: "2026-11-05T12:00:00Z" }),
      error: null,
    };
    await act(async () => {
      await atual.pedir("excluir_conta");
    });
    expect(atual.pedidos.map((p) => p.id)).toEqual(["novo", "velho"]);
  });

  it("o mesmo pedido devolvido de novo não duplica na lista", async () => {
    banco.lista = { data: [linhaDoBanco({ id: "mesmo" })], error: null };
    await montar();
    banco.padrao = { data: linhaDoBanco({ id: "mesmo" }), error: null };
    await act(async () => {
      await atual.pedir("excluir_conta");
    });
    expect(atual.pedidos.map((p) => p.id)).toEqual(["mesmo"]);
  });

  it("leitura que falhou deixa a carga em 'erro'; pedir com sucesso depois a põe em 'pronta'", async () => {
    banco.lista = { data: null, error: { code: "08006", message: "x" } };
    await montar();
    expect(atual.carga).toBe("erro");
    banco.padrao = { data: linhaDoBanco(), error: null };
    await act(async () => {
      await atual.pedir("excluir_conta");
    });
    expect(atual.carga).toBe("pronta");
    expect(atual.pedidos.map((p) => p.id)).toEqual(["ped-1"]);
  });

  it("leitura que falhou NÃO apaga a lista que já estava na tela (releitura com erro mantém os pedidos)", async () => {
    banco.lista = { data: [linhaDoBanco({ id: "antigo" })], error: null };
    await montar();
    banco.lista = { data: null, error: { code: "08006", message: "x" } };
    await act(async () => {
      await atual.recarregar();
    });
    expect(atual.carga).toBe("erro");
    expect(atual.pedidos.map((p) => p.id)).toEqual(["antigo"]);
  });

  it("trocou de conta com a leitura da anterior ainda no ar: a resposta atrasada NÃO aparece na conta nova", async () => {
    let soltarAntiga!: (r: Resposta) => void;
    banco.respostaDaConta.set(
      "conta-antiga",
      () =>
        new Promise<Resposta>((resolve) => {
          soltarAntiga = resolve;
        }),
    );
    banco.respostaDaConta.set("conta-nova", () =>
      Promise.resolve({
        data: [linhaDoBanco({ id: "da-nova", user_id: "conta-nova" })],
        error: null,
      }),
    );
    await montar("conta-antiga");
    expect(atual.carga).toBe("carregando");
    await montar("conta-nova");
    expect(atual.pedidos.map((p) => p.id)).toEqual(["da-nova"]);
    expect(atual.carga).toBe("pronta");

    // Só agora a leitura da conta antiga chega.
    await act(async () => {
      soltarAntiga({
        data: [linhaDoBanco({ id: "da-antiga", user_id: "conta-antiga" })],
        error: null,
      });
    });
    await assentar();
    expect(atual.pedidos.map((p) => p.id)).toEqual(["da-nova"]);
    expect(atual.carga).toBe("pronta");
  });

  it("a leitura atrasada que FALHOU também não derruba a conta nova para 'erro'", async () => {
    let soltarAntiga!: (r: Resposta) => void;
    banco.respostaDaConta.set(
      "conta-antiga",
      () =>
        new Promise<Resposta>((resolve) => {
          soltarAntiga = resolve;
        }),
    );
    banco.respostaDaConta.set("conta-nova", () =>
      Promise.resolve({ data: [linhaDoBanco({ id: "da-nova" })], error: null }),
    );
    await montar("conta-antiga");
    await montar("conta-nova");
    await act(async () => {
      soltarAntiga({ data: null, error: { code: "08006", message: "x" } });
    });
    await assentar();
    expect(atual.carga).toBe("pronta");
    expect(atual.pedidos.map((p) => p.id)).toEqual(["da-nova"]);
  });
});
