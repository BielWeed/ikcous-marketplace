// @vitest-environment jsdom
//
// O PRIMEIRO ENDEREÇO DA CONTA VIRA O PRINCIPAL -- E SÓ ELE.
//
// `addAddress` marca o endereço como principal sozinho quando a conta não tem
// nenhum: é o endereço que o checkout usa de entrega sem a cliente escolher.
// A guarda tem duas pernas e cada uma protege uma coisa diferente:
//   - lista LIDA e vazia  -> o novo vira principal (senão a conta fica sem
//     principal e o checkout cai num endereço "qualquer");
//   - lista com gente      -> o novo NÃO rouba a marca (o gatilho do banco
//     desmarcaria o principal que a cliente escolheu);
//   - leitura que FALHOU   -> lista vazia não prova "sem endereço": o novo
//     NÃO pode tomar a marca de um principal que existe e não foi lido.
// O banco aqui é um dublê que imita o gatilho de principal (a linha nova
// principal desmarca as outras) e registra o que foi mandado no insert.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAddresses } from "@/hooks/useAddresses";

const banco = vi.hoisted(() => ({
  linhas: [] as Array<Record<string, unknown>>,
  contador: 0,
  leituraFalha: false,
  inserts: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "conta-a" } }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock("@/lib/supabase", () => {
  const ordenadas = () =>
    [...banco.linhas].sort((a, b) => {
      if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
      return (b.created_at as number) - (a.created_at as number);
    });
  const consulta = (op: string, payload?: unknown) => {
    const executar = () => {
      if (op === "select") {
        return banco.leituraFalha
          ? { data: null, error: { message: "sem rede" } }
          : { data: ordenadas(), error: null };
      }
      const linha = {
        id: `end-${++banco.contador}`,
        created_at: banco.contador,
        ...(payload as object),
      } as Record<string, unknown>;
      banco.inserts.push({ ...(payload as object) });
      if (linha.is_default) {
        for (const outra of banco.linhas) outra.is_default = false;
      }
      banco.linhas.push(linha);
      return { data: [linha], error: null };
    };
    const cadeia: any = {
      eq: () => cadeia,
      order: () => cadeia,
      select: () => cadeia,
      single: async () => {
        const r = executar();
        return { data: r.data?.[0] ?? null, error: r.error };
      },
      // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
      then: (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) =>
        Promise.resolve(executar()).then(ok, ko),
    };
    return cadeia;
  };
  return {
    supabase: {
      from: () => ({
        select: () => consulta("select"),
        insert: (p: unknown) => consulta("insert", p),
        update: () => consulta("update"),
        delete: () => consulta("delete"),
      }),
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useAddresses>;

const base = {
  user_id: "conta-a",
  recipient_name: "Ana",
  cep: "38500-001",
  number: "1",
  complement: null,
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: null,
};

function semear(...nomes: Array<[string, boolean]>) {
  banco.linhas = nomes.map(([name, is_default]) => ({
    ...base,
    id: `end-${name}`,
    name,
    street: `Rua ${name}`,
    is_default,
    created_at: ++banco.contador,
  }));
}

const novoEndereco = (name: string, is_default = false) => ({
  name,
  recipient_name: "Ana",
  cep: "38500-001",
  street: `Rua ${name}`,
  number: "1",
  complement: null,
  neighborhood: "Centro",
  city: "Monte Carmelo",
  state: "MG",
  reference: null,
  is_default,
});

describe("useAddresses — quem vira o endereço principal ao cadastrar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let hook: Hook;

  function Sonda() {
    guardar(useAddresses());
    return null;
  }
  function guardar(h: Hook) {
    hook = h;
  }

  beforeEach(() => {
    banco.linhas = [];
    banco.contador = 0;
    banco.leituraFalha = false;
    banco.inserts.length = 0;
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  async function abrir() {
    await act(async () => {
      raiz.render(<Sonda />);
    });
    await act(async () => {
      await hook.fetchAddresses();
    });
  }

  const principais = () =>
    hook.addresses.filter((a) => a.is_default).map((a) => a.name);

  it("conta sem endereço: o primeiro vira principal mesmo vindo marcado como não principal", async () => {
    await abrir();
    expect(hook.addresses).toEqual([]);

    await act(async () => {
      await hook.addAddress(novoEndereco("Casa", false));
    });

    expect(banco.inserts).toHaveLength(1);
    expect(banco.inserts[0]?.is_default).toBe(true);
    expect(principais()).toEqual(["Casa"]);
  });

  it("conta que já tem endereço: o novo, sem marca, NÃO rouba o principal", async () => {
    semear(["Casa", true]);
    await abrir();
    expect(principais()).toEqual(["Casa"]);

    await act(async () => {
      await hook.addAddress(novoEndereco("Trabalho", false));
    });

    expect(banco.inserts).toHaveLength(1);
    expect(banco.inserts[0]?.is_default).toBe(false);
    expect(principais()).toEqual(["Casa"]);
    expect(hook.addresses.map((a) => a.name)).toEqual(["Casa", "Trabalho"]);
  });

  it("conta que já tem endereço: o novo marcado como principal tira a marca do antigo na lista", async () => {
    semear(["Casa", true], ["Trabalho", false]);
    await abrir();

    await act(async () => {
      await hook.addAddress(novoEndereco("Sitio", true));
    });

    expect(banco.inserts[0]?.is_default).toBe(true);
    expect(principais()).toEqual(["Sitio"]);
    expect(hook.addresses[0]?.name).toBe("Sitio");
    // O banco concorda com a tela: só uma linha principal.
    expect(banco.linhas.filter((l) => l.is_default).map((l) => l.name)).toEqual(
      ["Sitio"],
    );
  });

  it("leitura que falhou: lista vazia NÃO prova 'sem endereço' e o novo não toma a marca", async () => {
    // O principal existe no banco, mas a leitura caiu: a tela vê lista vazia.
    semear(["Casa", true]);
    banco.leituraFalha = true;
    await abrir();
    expect(hook.addresses).toEqual([]);

    await act(async () => {
      await hook.addAddress(novoEndereco("Trabalho", false));
    });

    expect(banco.inserts).toHaveLength(1);
    expect(banco.inserts[0]?.is_default).toBe(false);
    // A marca da Casa sobreviveu no banco.
    expect(banco.linhas.filter((l) => l.is_default).map((l) => l.name)).toEqual(
      ["Casa"],
    );
  });
});
