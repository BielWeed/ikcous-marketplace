// @vitest-environment jsdom
//
// EDITAR COM A TELA VELHA: SALVAR SEM MEXER NO PRINCIPAL NÃO O DEVOLVE (r84-b).
//
// O formulário de edição só manda `is_default` quando a cliente mexeu no botão
// "Endereço principal" (ver address-form-principal-so-vai-se-a-pessoa-mexeu).
// Aqui, o lado do gancho: uma edição SEM `is_default` não toca na marca no
// banco -- e, se outro aparelho mudou o principal desde a última leitura, a
// lista deste aparelho se reconcilia com o servidor (senão ficaria sem
// principal, ou com dois, até a próxima leitura). O "outro aparelho" é
// simulado mexendo no dublê do banco DIRETAMENTE.
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

describe("useAddresses — edição sem is_default e a marca de outro aparelho", () => {
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

  const principalNaTela = () =>
    hook.addresses.filter((a) => a.is_default).map((a) => a.name);
  const principalNoBanco = () =>
    banco.linhas.filter((l) => l.is_default).map((l) => l.name);
  const atualizacoes = () => banco.operacoes.filter((o) => o.op === "update");
  const leituras = () => banco.operacoes.filter((o) => o.op === "select");

  async function celularLeAListaDoServidor() {
    await act(async () => {
      await hook.fetchAddresses();
    });
  }

  it("o outro aparelho passou o principal de Casa para Mãe: editar Casa (sem is_default) NÃO devolve a marca, e a lista do celular se acerta", async () => {
    semear(["Casa", true], ["Trabalho", false], ["Mãe", false]);
    await celularLeAListaDoServidor();
    expect(principalNaTela()).toEqual(["Casa"]);

    outroAparelhoMarcaPrincipal("Mãe");
    banco.operacoes.length = 0;

    let ok: boolean | undefined;
    await act(async () => {
      ok = await hook.updateAddress("end-Casa", { complement: "Apto 2" });
    });

    expect(ok).toBe(true);
    // O que foi ao banco: só o complemento, sem tocar na marca.
    expect(atualizacoes()).toHaveLength(1);
    expect(atualizacoes()[0].payload).toEqual({ complement: "Apto 2" });
    expect(principalNoBanco()).toEqual(["Mãe"]);
    // A lista do celular não fica sem principal: relê o servidor.
    expect(principalNaTela()).toEqual(["Mãe"]);
    expect(hook.addresses.find((a) => a.name === "Casa")?.complement).toBe(
      "Apto 2",
    );
  });

  it("o outro aparelho fez de Casa (comum aqui) o principal: editar Casa não a desmarca, e a lista do celular não fica com DOIS principais", async () => {
    semear(["Casa", false], ["Trabalho", true]);
    await celularLeAListaDoServidor();
    expect(principalNaTela()).toEqual(["Trabalho"]);

    outroAparelhoMarcaPrincipal("Casa");
    banco.operacoes.length = 0;

    await act(async () => {
      await hook.updateAddress("end-Casa", { complement: "Fundos" });
    });

    expect(principalNoBanco()).toEqual(["Casa"]);
    expect(principalNaTela()).toEqual(["Casa"]);
  });

  it("CONTROLE: nada mudou em outro aparelho -- a edição não relê o servidor e o principal fica", async () => {
    semear(["Casa", true], ["Trabalho", false]);
    await celularLeAListaDoServidor();
    banco.operacoes.length = 0;

    await act(async () => {
      await hook.updateAddress("end-Casa", { complement: "Apto 2" });
    });

    expect(leituras()).toHaveLength(0);
    expect(atualizacoes()).toHaveLength(1);
    expect(principalNoBanco()).toEqual(["Casa"]);
    expect(principalNaTela()).toEqual(["Casa"]);
  });

  it("CONTROLE: a cliente LIGA o principal de propósito (is_default true): a escolha dela vale e as outras se desmarcam", async () => {
    semear(["Casa", true], ["Trabalho", false]);
    await celularLeAListaDoServidor();

    await act(async () => {
      await hook.updateAddress("end-Trabalho", { is_default: true });
    });

    expect(principalNoBanco()).toEqual(["Trabalho"]);
    expect(principalNaTela()).toEqual(["Trabalho"]);
  });

  it("a releitura de acerto falha: a edição vale, sem aviso de erro (a lista guardada segue como antes)", async () => {
    semear(["Casa", true], ["Mãe", false]);
    await celularLeAListaDoServidor();
    outroAparelhoMarcaPrincipal("Mãe");

    banco.falharLeitura = true;
    let ok: boolean | undefined;
    await act(async () => {
      ok = await hook.updateAddress("end-Casa", { complement: "Apto 2" });
    });

    expect(ok).toBe(true);
    expect(avisos.error).not.toHaveBeenCalled();
    expect(avisos.success).toHaveBeenCalledWith("Endereço atualizado");
    expect(principalNoBanco()).toEqual(["Mãe"]);
  });
});
