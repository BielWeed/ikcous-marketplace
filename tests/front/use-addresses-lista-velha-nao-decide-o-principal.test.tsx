// @vitest-environment jsdom
//
// DOIS APARELHOS, UMA CONTA: A LISTA VELHA NÃO DECIDE O PRINCIPAL.
//
// A cliente entra com a mesma conta no celular (A) e no tablet (B). Os dois
// mostram Casa (principal), Trabalho e Mãe. No tablet ela marca "Mãe" como
// principal; no celular, que ainda mostra a lista antiga, ela apaga "Casa".
// O app do celular decidia "apaguei o principal, promovo o próximo da MINHA
// lista" e gravava "Trabalho" no banco -- o gatilho do banco então tirava a
// marca de "Mãe", que a cliente tinha acabado de escolher. A variação inversa
// deixava a conta SEM principal. Agora, depois de apagar (ou desligar o
// principal), o aparelho relê a lista do servidor e só promove se a lista
// fresca não tem principal.
//
// O "outro aparelho" é simulado mexendo no dublê do banco DIRETAMENTE, sem
// passar pelo hook (e sem a publicação entre telas do mesmo aparelho): é
// exatamente o que o celular não sabe.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAddresses } from "@/hooks/useAddresses";

const banco = vi.hoisted(() => ({
  linhas: [] as Array<Record<string, unknown>>,
  contador: 0,
  falharLeitura: false,
  operacoes: [] as Array<{ op: string; payload?: unknown; filtros: unknown }>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "conta-a" } }),
}));

const avisos = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: avisos }));

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
      if (op === "select") {
        if (banco.falharLeitura) {
          return { data: null, error: { message: "rede caiu" } };
        }
        return { data: ordenadas().filter(casa), error: null };
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

// Do mais antigo ao mais novo: Casa, Trabalho, Mãe.
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

// O que o OUTRO aparelho faz: grava direto no banco (com o gatilho).
function outroAparelhoMarcaPrincipal(nome: string) {
  for (const l of banco.linhas) l.is_default = l.name === nome;
}

describe("useAddresses — lista guardada no aparelho não decide o principal", () => {
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
    banco.falharLeitura = false;
    banco.operacoes.length = 0;
    avisos.success.mockClear();
    avisos.error.mockClear();
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
  const principalNaTela = () =>
    hook.addresses.filter((a) => a.is_default).map((a) => a.name);
  const principalNoBanco = () =>
    banco.linhas.filter((l) => l.is_default).map((l) => l.name);
  const atualizacoesNoBanco = () =>
    banco.operacoes.filter((o) => o.op === "update");

  async function celularLeAListaDoServidor() {
    await act(async () => {
      await hook.fetchAddresses();
    });
  }

  describe("apagar", () => {
    it("o tablet marcou Mãe e o celular apaga Casa: Mãe continua principal e ninguém é promovido", async () => {
      semear(["Casa", true], ["Trabalho", false], ["Mãe", false]);
      await celularLeAListaDoServidor();
      expect(principalNaTela()).toEqual(["Casa"]);

      outroAparelhoMarcaPrincipal("Mãe");
      banco.operacoes.length = 0;

      let ok: boolean | undefined;
      await act(async () => {
        ok = await hook.deleteAddress("end-Casa");
      });

      expect(ok).toBe(true);
      expect(principalNoBanco()).toEqual(["Mãe"]);
      expect(atualizacoesNoBanco()).toHaveLength(0);
      // A lista do celular já nasce certa: a do servidor.
      expect(principalNaTela()).toEqual(["Mãe"]);
      expect(nomes()).toEqual(["Mãe", "Trabalho"]);
    });

    it("o tablet marcou Casa e o celular, que a achava comum, apaga Casa: sobra um principal (não fica sem)", async () => {
      semear(["Casa", false], ["Trabalho", true], ["Mãe", false]);
      await celularLeAListaDoServidor();
      expect(principalNaTela()).toEqual(["Trabalho"]);

      // No tablet: Casa vira principal. No celular, Casa ainda é "comum".
      outroAparelhoMarcaPrincipal("Casa");

      await act(async () => {
        await hook.deleteAddress("end-Casa");
      });

      // Sem a relida, ninguém era promovido e a conta ficava sem principal.
      expect(principalNoBanco()).toHaveLength(1);
      expect(principalNoBanco()).toEqual(["Mãe"]);
      expect(principalNaTela()).toEqual(["Mãe"]);
      expect(nomes()).toEqual(["Mãe", "Trabalho"]);
    });

    it("lista fresca sem principal e sem endereço nenhum: não promove, lista vazia", async () => {
      semear(["Casa", true]);
      await celularLeAListaDoServidor();
      banco.operacoes.length = 0;

      await act(async () => {
        await hook.deleteAddress("end-Casa");
      });

      expect(nomes()).toEqual([]);
      expect(atualizacoesNoBanco()).toHaveLength(0);
    });

    it("CONTROLE (um aparelho só): apagar o principal promove o mais recente", async () => {
      semear(["Casa", true], ["Trabalho", false], ["Mãe", false]);
      await celularLeAListaDoServidor();

      await act(async () => {
        await hook.deleteAddress("end-Casa");
      });

      expect(principalNoBanco()).toEqual(["Mãe"]);
      expect(principalNaTela()).toEqual(["Mãe"]);
      expect(atualizacoesNoBanco()).toHaveLength(1);
    });

    it("a releitura falhou: o que a cliente fez fica (apagou, avisa sucesso) e o comportamento de antes vale", async () => {
      semear(["Casa", true], ["Trabalho", false], ["Mãe", false]);
      await celularLeAListaDoServidor();

      banco.falharLeitura = true;
      let ok: boolean | undefined;
      await act(async () => {
        ok = await hook.deleteAddress("end-Casa");
      });

      expect(ok).toBe(true);
      expect(banco.linhas.map((l) => l.name)).not.toContain("Casa");
      expect(avisos.success).toHaveBeenCalledWith("Endereço removido");
      expect(avisos.error).not.toHaveBeenCalled();
      // Sem a lista fresca, vale a lista guardada, como antes.
      expect(principalNoBanco()).toEqual(["Mãe"]);
      expect(principalNaTela()).toEqual(["Mãe"]);
      expect(nomes()).toEqual(["Mãe", "Trabalho"]);
    });

    it("a releitura é UMA só por exclusão e filtra pela conta", async () => {
      semear(["Casa", true], ["Trabalho", false]);
      await celularLeAListaDoServidor();
      banco.operacoes.length = 0;

      await act(async () => {
        await hook.deleteAddress("end-Trabalho");
      });

      const leituras = banco.operacoes.filter((o) => o.op === "select");
      expect(leituras).toHaveLength(1);
      expect(leituras[0].filtros).toEqual({ user_id: "conta-a" });
      expect(atualizacoesNoBanco()).toHaveLength(0);
    });
  });

  describe("desligar o principal (editar)", () => {
    it("o tablet marcou Mãe e o celular desmarca Casa: Mãe continua principal e ninguém é promovido", async () => {
      semear(["Casa", true], ["Trabalho", false], ["Mãe", false]);
      await celularLeAListaDoServidor();

      outroAparelhoMarcaPrincipal("Mãe");
      banco.operacoes.length = 0;

      let ok: boolean | undefined;
      await act(async () => {
        ok = await hook.updateAddress("end-Casa", { is_default: false });
      });

      expect(ok).toBe(true);
      expect(principalNoBanco()).toEqual(["Mãe"]);
      // Só a edição da cliente: nenhuma promoção por conta própria.
      expect(atualizacoesNoBanco()).toHaveLength(1);
      expect(principalNaTela()).toEqual(["Mãe"]);
      expect(nomes().sort()).toEqual(["Casa", "Mãe", "Trabalho"]);
    });

    it("o tablet marcou Casa e o celular, que a achava comum, a desmarca: sobra um principal (não fica sem)", async () => {
      semear(["Casa", false], ["Trabalho", true], ["Mãe", false]);
      await celularLeAListaDoServidor();

      outroAparelhoMarcaPrincipal("Casa");

      await act(async () => {
        await hook.updateAddress("end-Casa", { is_default: false });
      });

      expect(principalNoBanco()).toHaveLength(1);
      expect(principalNoBanco()).not.toContain("Casa");
      expect(principalNaTela()).toEqual(principalNoBanco());
      expect(nomes().sort()).toEqual(["Casa", "Mãe", "Trabalho"]);
    });

    it("a releitura falhou: a edição vale e a promoção segue a lista guardada, como antes", async () => {
      semear(["Casa", true], ["Trabalho", false], ["Mãe", false]);
      await celularLeAListaDoServidor();

      // No dublê o UPDATE é a operação "update" (o `.select().single()` dele
      // não conta como leitura): só a RELEITURA depois dele falha.
      banco.falharLeitura = true;
      let ok: boolean | undefined;
      await act(async () => {
        ok = await hook.updateAddress("end-Casa", { is_default: false });
      });

      expect(ok).toBe(true);
      expect(avisos.error).not.toHaveBeenCalled();
      expect(principalNoBanco()).toEqual(["Mãe"]);
      expect(principalNaTela()).toEqual(["Mãe"]);
    });

    it("CONTROLE (formulário real, que SEMPRE manda is_default): editar um endereço comum relê UMA vez e não promove, pois a lista fresca já tem principal", async () => {
      semear(["Casa", true], ["Trabalho", false]);
      await celularLeAListaDoServidor();
      banco.operacoes.length = 0;

      await act(async () => {
        await hook.updateAddress("end-Trabalho", {
          name: "Trabalho novo",
          is_default: false,
        });
      });

      expect(banco.operacoes.filter((o) => o.op === "select")).toHaveLength(1);
      // Só a edição da cliente: ninguém é promovido.
      expect(atualizacoesNoBanco()).toHaveLength(1);
      expect(principalNoBanco()).toEqual(["Casa"]);
      expect(principalNaTela()).toEqual(["Casa"]);
    });

    it("CONTROLE: edição que não fala de principal (sem is_default) não relê nem promove", async () => {
      semear(["Casa", true], ["Trabalho", false]);
      await celularLeAListaDoServidor();
      banco.operacoes.length = 0;

      await act(async () => {
        await hook.updateAddress("end-Trabalho", { name: "Trabalho novo" });
      });

      expect(banco.operacoes.filter((o) => o.op === "select")).toHaveLength(0);
      expect(atualizacoesNoBanco()).toHaveLength(1);
      expect(principalNoBanco()).toEqual(["Casa"]);
    });
  });
});
