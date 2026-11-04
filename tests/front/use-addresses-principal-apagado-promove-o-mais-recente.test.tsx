// @vitest-environment jsdom
//
// APAGAR (OU DESLIGAR) O ENDEREÇO PRINCIPAL (rodada 5, achado 1).
//
// O gatilho do banco só age quando a linha NOVA é principal; apagar ou
// desligar o principal deixava a conta sem nenhum, e o carrinho caía no
// primeiro da lista local. Pior: `addAddress` punha o endereço novo no FIM da
// lista local, mas o banco ordena "principal primeiro, depois o mais novo" —
// então, depois de recarregar o app, o endereço de entrega (e o frete) mudava
// sozinho. Regra nova: sobrando endereço, o mais recente vira o principal (no
// banco e na lista), e o novo entra na lista no lugar que a ordenação do
// banco usaria (logo depois do principal).
//
// O banco aqui é um dublê que imita a ordenação e o gatilho de principal.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAddresses } from "@/hooks/useAddresses";

type Linha = Record<string, unknown> & {
  id: string;
  is_default: boolean;
  created_at: number;
};

const banco = vi.hoisted(() => ({
  linhas: [] as Array<Record<string, unknown>>,
  contador: 0,
  operacoes: [] as Array<{ op: string; payload?: unknown; filtros: unknown }>,
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
  // Gatilho handle_default_address: linha principal desmarca as outras.
  const aplicarGatilho = (linha: Record<string, unknown>) => {
    if (!linha.is_default) return;
    for (const outra of banco.linhas) {
      if (outra !== linha) outra.is_default = false;
    }
  };
  const consulta = (op: string, payload?: unknown) => {
    const filtros = new Map<string, unknown>();
    const executar = () => {
      banco.operacoes.push({
        op,
        payload,
        filtros: Object.fromEntries(filtros),
      });
      const casa = (l: Record<string, unknown>) =>
        [...filtros].every(([k, v]) => Reflect.get(l, k) === v);
      if (op === "select") return { data: ordenadas(), error: null };
      if (op === "insert") {
        const linha = {
          id: `end-${++banco.contador}`,
          created_at: banco.contador,
          ...(payload as object),
        } as Record<string, unknown>;
        banco.linhas.push(linha);
        aplicarGatilho(linha);
        return { data: [linha], error: null };
      }
      if (op === "update") {
        const alvo = banco.linhas.filter(casa);
        for (const l of alvo) {
          Object.assign(l, payload);
          aplicarGatilho(l);
        }
        return { data: alvo, error: null };
      }
      banco.linhas = banco.linhas.filter((l) => !casa(l));
      return { data: null, error: null };
    };
    const cadeia: any = {
      eq: (k: string, v: unknown) => {
        filtros.set(k, v);
        return cadeia;
      },
      order: () => cadeia,
      select: () => cadeia,
      single: async () => {
        const r = executar();
        return { data: r.data?.[0] ?? null, error: null };
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
        update: (p: unknown) => consulta("update", p),
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
  })) as Linha[];
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

describe("useAddresses — sempre que sobra endereço, existe um principal", () => {
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

  beforeEach(async () => {
    banco.linhas = [];
    banco.contador = 0;
    banco.operacoes.length = 0;
    localStorage.clear();
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Sonda />);
    });
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  const nomes = () => hook.addresses.map((a) => a.name);
  const principal = () => hook.addresses.find((a) => a.is_default)?.name;
  const principalNoBanco = () =>
    banco.linhas.filter((l) => l.is_default).map((l) => l.name);
  const ordemNoBanco = () =>
    [...banco.linhas]
      .sort((a, b) =>
        a.is_default !== b.is_default
          ? a.is_default
            ? -1
            : 1
          : (b.created_at as number) - (a.created_at as number),
      )
      .map((l) => l.name);

  async function ler() {
    await act(async () => {
      await hook.fetchAddresses();
    });
  }

  it("apagar o principal promove o mais recente que sobrou (lista e banco)", async () => {
    // Do mais antigo ao mais novo: Casa (principal), Sitio, Trabalho.
    semear(["Casa", true], ["Sitio", false], ["Trabalho", false]);
    await ler();
    expect(nomes()).toEqual(["Casa", "Trabalho", "Sitio"]);

    await act(async () => {
      await hook.deleteAddress("end-Casa");
    });

    expect(nomes()).toEqual(["Trabalho", "Sitio"]);
    expect(principal()).toBe("Trabalho");
    expect(principalNoBanco()).toEqual(["Trabalho"]);
  });

  it("apagar o principal e cadastrar uma Casa nova: lista local e lista recarregada coincidem", async () => {
    semear(["Casa", true], ["Trabalho", false]);
    await ler();
    await act(async () => {
      await hook.deleteAddress("end-Casa");
    });
    await act(async () => {
      await hook.addAddress(novoEndereco("Casa nova"));
    });

    const local = nomes();
    expect(principal()).toBe("Trabalho");
    // Antes: a lista local ficava [Trabalho, Casa nova] mas o carrinho podia
    // cair em outro endereço depois de recarregar. Agora as duas coincidem.
    await ler();
    expect(nomes()).toEqual(local);
    expect(principal()).toBe("Trabalho");
  });

  it("endereço novo (não principal) entra logo depois do principal, como o banco ordena", async () => {
    semear(["Casa", true], ["Trabalho", false]);
    await ler();

    await act(async () => {
      await hook.addAddress(novoEndereco("Sitio"));
    });

    expect(nomes()).toEqual(ordemNoBanco());
    expect(nomes()).toEqual(["Casa", "Sitio", "Trabalho"]);
  });

  it("endereço novo sem nenhum principal na lista entra no início", async () => {
    semear(["Casa", false], ["Trabalho", false]);
    await ler();

    await act(async () => {
      await hook.addAddress(novoEndereco("Sitio"));
    });

    expect(nomes()).toEqual(ordemNoBanco());
    expect(nomes()[0]).toBe("Sitio");
  });

  it("desligar o principal promove o mais recente dos outros", async () => {
    semear(["Casa", true], ["Sitio", false], ["Trabalho", false]);
    await ler();

    await act(async () => {
      await hook.updateAddress("end-Casa", { is_default: false });
    });

    expect(principal()).toBe("Trabalho");
    expect(principalNoBanco()).toEqual(["Trabalho"]);
    expect(hook.addresses.filter((a) => a.is_default)).toHaveLength(1);
    expect(hook.addresses.map((a) => a.name).sort()).toEqual([
      "Casa",
      "Sitio",
      "Trabalho",
    ]);
  });

  it("CONTROLE: desligar o principal quando é o único endereço não promove ninguém", async () => {
    semear(["Casa", true]);
    await ler();
    banco.operacoes.length = 0;

    await act(async () => {
      await hook.updateAddress("end-Casa", { is_default: false });
    });

    expect(principal()).toBeUndefined();
    expect(banco.operacoes.filter((o) => o.op === "update")).toHaveLength(1);
  });

  it("CONTROLE: apagar um endereço que NÃO é o principal não promove ninguém", async () => {
    semear(["Casa", true], ["Trabalho", false]);
    await ler();
    banco.operacoes.length = 0;

    await act(async () => {
      await hook.deleteAddress("end-Trabalho");
    });

    expect(nomes()).toEqual(["Casa"]);
    expect(principal()).toBe("Casa");
    expect(banco.operacoes.map((o) => o.op)).toEqual(["delete"]);
  });

  it("CONTROLE: apagar o único endereço deixa a lista vazia, sem promoção", async () => {
    semear(["Casa", true]);
    await ler();
    banco.operacoes.length = 0;

    await act(async () => {
      await hook.deleteAddress("end-Casa");
    });

    expect(nomes()).toEqual([]);
    expect(banco.operacoes.map((o) => o.op)).toEqual(["delete"]);
  });
});
