// @vitest-environment jsdom
//
// Central de Fornecedores, E1: o hook `useFornecedores` (lista, criar, editar,
// favoritar, excluir) falando com a tabela `fornecedores` pelo cliente Supabase
// do app. Hook REAL, Supabase simulado.
//
// O que se prova (o limite que dói, não só o caminho feliz):
//   a. lista vem ordenada (favoritos primeiro, depois por nome) e inativo não busca;
//   b. CRIAR usa o id gerado ANTES (upsert por id): tocar duas vezes ou repetir
//      depois de resposta perdida regrava a MESMA linha, nunca duplica;
//   c. EDITAR/FAVORITAR de linha que sumiu (outro aparelho) NÃO diz "salvo":
//      PostgREST devolve 200 com zero linhas e o hook transforma isso em erro;
//   d. EXCLUIR: zero linhas + a linha ainda existe = permissão perdida (erro);
//      zero linhas + a linha não existe = já tinha sido excluída (sucesso);
//   e. erro do banco vira frase em português (permissão, tabela ausente,
//      campo recusado, rede), sem texto cru nem console.log;
//   f. toque duplo na estrela não dispara duas gravações.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFornecedores } from "@/hooks/useFornecedores";

type Resultado = { data: unknown; error: unknown };

const banco = vi.hoisted(() => ({
  fila: [] as Array<{ data: unknown; error: unknown }>,
  chamadas: [] as Array<{ metodo: string; args: unknown[] }>,
}));

function proximo(): Resultado {
  const r = banco.fila.shift();
  if (!r) throw new Error("o teste não programou a resposta desta chamada");
  return r;
}

vi.mock("@/lib/supabase", () => {
  const construtor = () => {
    const b: any = {};
    for (const metodo of [
      "select",
      "upsert",
      "update",
      "delete",
      "eq",
      "order",
      "range",
      "single",
      "maybeSingle",
    ]) {
      // eslint-disable-next-line security/detect-object-injection -- metodo vem so da lista literal acima.
      b[metodo] = (...args: unknown[]) => {
        banco.chamadas.push({ metodo, args });
        return b;
      };
    }
    // O PostgREST devolve um construtor que se pode `await`: o fake precisa ser "thenable" de propósito.
    // biome-ignore lint/suspicious/noThenProperty: simula o builder do supabase-js, que é thenable
    b.then = (ok: (r: Resultado) => unknown, falha: (e: unknown) => unknown) =>
      Promise.resolve().then(proximo).then(ok, falha);
    return b;
  };
  return {
    supabase: {
      from: (tabela: string) => {
        banco.chamadas.push({ metodo: "from", args: [tabela] });
        return construtor();
      },
    },
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Api = ReturnType<typeof useFornecedores>;

function linha(id: string, nome: string, favorito = false) {
  return {
    id,
    nome,
    whatsapp: null,
    instagram: null,
    site: null,
    cidade: null,
    uf: null,
    observacoes: null,
    favorito,
  };
}

const DADOS = {
  nome: "Atacado Novo",
  whatsapp: "5511900000000",
  instagram: null,
  site: null,
  cidade: null,
  uf: null,
  observacoes: null,
  favorito: false,
};

describe("useFornecedores", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let api: Api;
  let espiaConsole: ReturnType<typeof vi.spyOn>[];

  function Sonda({ ativo }: { ativo: boolean }) {
    const retorno = useFornecedores(ativo);
    useEffect(() => {
      api = retorno;
    });
    return null;
  }

  async function montar(ativo = true) {
    await act(async () => {
      raiz.render(<Sonda ativo={ativo} />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  beforeEach(() => {
    banco.fila.length = 0;
    banco.chamadas.length = 0;
    espiaConsole = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("inativo não busca nada", async () => {
    await montar(false);
    expect(banco.chamadas).toEqual([]);
    expect(api.fornecedores).toBeNull();
  });

  it("lista ordenada: favoritos primeiro, depois por nome", async () => {
    banco.fila.push({
      data: [linha("1", "Zeta"), linha("2", "Álamo"), linha("3", "Beta", true)],
      error: null,
    });
    await montar();
    expect(api.fornecedores?.map((f) => f.nome)).toEqual([
      "Beta",
      "Álamo",
      "Zeta",
    ]);
    expect(api.erro).toBeNull();
    expect(api.carregando).toBe(false);
    expect(banco.chamadas[0]).toEqual({
      metodo: "from",
      args: ["fornecedores"],
    });
  });

  it("lista vazia é lista vazia (não é erro)", async () => {
    banco.fila.push({ data: [], error: null });
    await montar();
    expect(api.fornecedores).toEqual([]);
    expect(api.erro).toBeNull();
  });

  it("erro de leitura vira frase em português e segue sem lista", async () => {
    banco.fila.push({
      data: null,
      error: {
        code: "42501",
        message: "permission denied for table fornecedores",
      },
    });
    await montar();
    expect(api.fornecedores).toBeNull();
    expect(api.erro).toBe(
      "Só o administrador da loja mexe nos fornecedores. Entre de novo com a conta de administrador.",
    );
  });

  it("tabela ausente (migration não aplicada nesta loja) diz isso com clareza", async () => {
    banco.fila.push({
      data: null,
      error: {
        code: "PGRST205",
        message: "Could not find the table 'public.fornecedores'",
      },
    });
    await montar();
    expect(api.erro).toBe(
      "Os fornecedores ainda não foram instalados no banco desta loja. Fale com o suporte.",
    );
  });

  it("queda de rede na leitura: frase de conexão, sem texto cru", async () => {
    banco.fila.push({
      data: null,
      error: { message: "TypeError: Failed to fetch" },
    });
    await montar();
    expect(api.erro).toBe(
      "Não consegui falar com o servidor. Confira a internet e tente de novo.",
    );
  });

  it("recarregar busca de novo e limpa o erro", async () => {
    banco.fila.push({ data: null, error: { message: "Failed to fetch" } });
    await montar();
    expect(api.erro).not.toBeNull();
    banco.fila.push({ data: [linha("1", "Alfa")], error: null });
    await act(async () => {
      api.recarregar();
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(api.erro).toBeNull();
    expect(api.fornecedores).toHaveLength(1);
  });

  describe("criar", () => {
    it("grava por upsert no id que a tela gerou e põe a linha na lista, já ordenada", async () => {
      banco.fila.push({ data: [linha("1", "Zeta")], error: null });
      await montar();
      banco.fila.push({
        data: {
          ...linha("id-novo", "Atacado Novo"),
          whatsapp: "5511900000000",
        },
        error: null,
      });
      await act(async () => {
        await api.criar("id-novo", DADOS);
      });
      const upsert = banco.chamadas.find((c) => c.metodo === "upsert");
      expect(upsert?.args[0]).toMatchObject({
        id: "id-novo",
        nome: "Atacado Novo",
      });
      expect(upsert?.args[1]).toEqual({ onConflict: "id" });
      expect(api.fornecedores?.map((f) => f.nome)).toEqual([
        "Atacado Novo",
        "Zeta",
      ]);
    });

    it("repetir o mesmo id (toque duplo ou resposta perdida) troca a linha, não duplica", async () => {
      banco.fila.push({ data: [], error: null });
      await montar();
      for (let i = 0; i < 2; i++) {
        banco.fila.push({
          data: linha("mesmo-id", "Atacado Novo"),
          error: null,
        });
        await act(async () => {
          await api.criar("mesmo-id", DADOS);
        });
      }
      expect(api.fornecedores).toHaveLength(1);
    });

    it("dois toques ao mesmo tempo no mesmo id: só UMA gravação sai", async () => {
      banco.fila.push({ data: [], error: null });
      await montar();
      banco.fila.push({ data: linha("x", "Atacado Novo"), error: null });
      await act(async () => {
        await Promise.all([api.criar("x", DADOS), api.criar("x", DADOS)]);
      });
      expect(banco.chamadas.filter((c) => c.metodo === "upsert")).toHaveLength(
        1,
      );
    });

    it("recusa do banco vira erro em português e a lista não muda", async () => {
      banco.fila.push({ data: [linha("1", "Zeta")], error: null });
      await montar();
      banco.fila.push({
        data: null,
        error: {
          code: "42501",
          message: "new row violates row-level security policy",
        },
      });
      await expect(api.criar("n", DADOS)).rejects.toThrow(
        "Só o administrador da loja mexe nos fornecedores. Entre de novo com a conta de administrador.",
      );
      expect(api.fornecedores).toHaveLength(1);
    });

    it("campo recusado pelo CHECK (23514) pede para conferir os dados", async () => {
      banco.fila.push({ data: [], error: null });
      await montar();
      banco.fila.push({
        data: null,
        error: { code: "23514", message: "violates check constraint" },
      });
      await expect(api.criar("n", DADOS)).rejects.toThrow(
        "O banco recusou algum campo. Confira os dados e tente de novo.",
      );
    });
  });

  describe("editar e favoritar", () => {
    it("editar troca a linha e reordena", async () => {
      banco.fila.push({
        data: [linha("1", "Alfa"), linha("2", "Beta")],
        error: null,
      });
      await montar();
      banco.fila.push({ data: [linha("1", "Zulu")], error: null });
      await act(async () => {
        await api.editar("1", { ...DADOS, nome: "Zulu" });
      });
      expect(api.fornecedores?.map((f) => f.nome)).toEqual(["Beta", "Zulu"]);
    });

    it("editar linha que sumiu (zero linhas) NÃO diz salvo: avisa que foi excluída", async () => {
      banco.fila.push({ data: [linha("1", "Alfa")], error: null });
      await montar();
      banco.fila.push({ data: [], error: null });
      await expect(api.editar("1", DADOS)).rejects.toThrow(
        "Este fornecedor não existe mais (talvez tenha sido excluído em outro aparelho). Atualize a lista.",
      );
    });

    it("favoritar muda só a estrela e sobe para o topo", async () => {
      banco.fila.push({
        data: [linha("1", "Alfa"), linha("2", "Beta")],
        error: null,
      });
      await montar();
      banco.fila.push({ data: [linha("2", "Beta", true)], error: null });
      await act(async () => {
        await api.favoritar("2", true);
      });
      expect(api.fornecedores?.[0]).toMatchObject({ id: "2", favorito: true });
      const upd = banco.chamadas.find((c) => c.metodo === "update");
      expect(upd?.args[0]).toEqual({ favorito: true });
    });

    it("favoritar linha que sumiu: erro, lista intacta", async () => {
      banco.fila.push({ data: [linha("1", "Alfa")], error: null });
      await montar();
      banco.fila.push({ data: [], error: null });
      await expect(api.favoritar("1", true)).rejects.toThrow(/não existe mais/);
      expect(api.fornecedores?.[0].favorito).toBe(false);
    });

    it("toque duplo na estrela: só uma gravação sai", async () => {
      banco.fila.push({ data: [linha("1", "Alfa")], error: null });
      await montar();
      banco.fila.push({ data: [linha("1", "Alfa", true)], error: null });
      await act(async () => {
        await Promise.all([api.favoritar("1", true), api.favoritar("1", true)]);
      });
      expect(banco.chamadas.filter((c) => c.metodo === "update")).toHaveLength(
        1,
      );
    });
  });

  describe("excluir", () => {
    it("exclui e tira da lista", async () => {
      banco.fila.push({
        data: [linha("1", "Alfa"), linha("2", "Beta")],
        error: null,
      });
      await montar();
      banco.fila.push({ data: [{ id: "1" }], error: null });
      await act(async () => {
        await api.excluir("1");
      });
      expect(api.fornecedores?.map((f) => f.id)).toEqual(["2"]);
    });

    it("zero linhas e a linha NÃO existe mais = já tinha sido excluída: sucesso", async () => {
      banco.fila.push({ data: [linha("1", "Alfa")], error: null });
      await montar();
      banco.fila.push({ data: [], error: null }); // delete devolveu nada
      banco.fila.push({ data: null, error: null }); // releitura: não existe
      await act(async () => {
        await api.excluir("1");
      });
      expect(api.fornecedores).toEqual([]);
    });

    it("zero linhas mas a linha AINDA existe = sem permissão: erro, a linha fica", async () => {
      banco.fila.push({ data: [linha("1", "Alfa")], error: null });
      await montar();
      banco.fila.push({ data: [], error: null }); // delete não apagou (RLS esconde sem erro)
      banco.fila.push({ data: { id: "1" }, error: null }); // releitura: ainda está lá
      await expect(api.excluir("1")).rejects.toThrow(
        "Só o administrador da loja mexe nos fornecedores. Entre de novo com a conta de administrador.",
      );
      expect(api.fornecedores).toHaveLength(1);
    });

    it("queda de rede ao excluir: erro de conexão, a linha fica", async () => {
      banco.fila.push({ data: [linha("1", "Alfa")], error: null });
      await montar();
      banco.fila.push({ data: null, error: { message: "Failed to fetch" } });
      await expect(api.excluir("1")).rejects.toThrow(
        "Não consegui falar com o servidor. Confira a internet e tente de novo.",
      );
      expect(api.fornecedores).toHaveLength(1);
    });
  });

  it("nunca escreve dado de fornecedor no console", async () => {
    banco.fila.push({ data: [linha("1", "Alfa")], error: null });
    await montar();
    banco.fila.push({ data: null, error: { message: "Failed to fetch" } });
    await expect(api.excluir("1")).rejects.toThrow();
    for (const espia of espiaConsole) expect(espia).not.toHaveBeenCalled();
  });
});
