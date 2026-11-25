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
//   d. EXCLUIR com zero linhas NÃO diz "excluído": recarrega a lista do servidor e
//      avisa que a lista mudou (ler e apagar usam a mesma regra no banco, então
//      reler a linha não distingue nada: o ramo da releitura não existe mais);
//   e. erro do banco vira frase em português (permissão, tabela ausente,
//      campo recusado, rede), sem texto cru nem console.log;
//   f. toque duplo na estrela não dispara duas gravações;
//   g. AÇÕES DIFERENTES no mesmo id esperam uma a outra (favoritar a caminho +
//      editar/excluir: a segunda roda DEPOIS, com a própria resposta; nunca recebe
//      a promessa da primeira nem roda em paralelo); a mesma ação continua ignorada
//      no toque duplo; id diferente nunca espera; falha da primeira não trava a fila.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFornecedores } from "@/hooks/useFornecedores";

type Resultado = { data: unknown; error: unknown };

const banco = vi.hoisted(() => ({
  // Uma entrada pode ser uma promessa solta (adiada): segura aquela chamada até o teste soltar.
  fila: [] as Array<
    | { data: unknown; error: unknown }
    | Promise<{ data: unknown; error: unknown }>
  >,
  chamadas: [] as Array<{ metodo: string; args: unknown[] }>,
}));

function proximo(): Resultado | Promise<Resultado> {
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

/** Promessa que o teste solta quando quiser: segura a gravação "a caminho". */
function adiada() {
  let resolver!: (r: Resultado) => void;
  const promessa = new Promise<Resultado>((ok) => {
    resolver = ok;
  });
  return { promessa, resolver };
}

const chamadasDe = (metodo: string) =>
  banco.chamadas.filter((c) => c.metodo === metodo);

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

  describe("ações diferentes no mesmo fornecedor esperam uma a outra", () => {
    it("favoritar a caminho + editar: o update da edição SAI (com o WhatsApp novo) e o resultado é o da edição", async () => {
      banco.fila.push({ data: [linha("1", "Alfa")], error: null });
      await montar();
      const estrela = adiada();
      banco.fila.push(estrela.promessa); // favoritar: a caminho
      banco.fila.push({
        data: [{ ...linha("1", "Alfa", true), whatsapp: "5511911112222" }],
        error: null,
      }); // editar
      let favoritando!: Promise<unknown>;
      let editando!: Promise<{ whatsapp: string | null; favorito: boolean }>;
      await act(async () => {
        favoritando = api.favoritar("1", true);
        editando = api.editar("1", { whatsapp: "5511911112222" });
        await new Promise((r) => setTimeout(r, 0));
      });
      // A edição ESPERA: nada de segunda gravação em paralelo.
      expect(chamadasDe("update")).toHaveLength(1);
      await act(async () => {
        estrela.resolver({ data: [linha("1", "Alfa", true)], error: null });
        await favoritando;
      });
      let resultado!: { whatsapp: string | null; favorito: boolean };
      await act(async () => {
        resultado = await editando;
      });
      const updates = chamadasDe("update");
      expect(updates).toHaveLength(2);
      expect(updates[0].args[0]).toEqual({ favorito: true });
      expect(updates[1].args[0]).toEqual({ whatsapp: "5511911112222" });
      // O resultado reportado é o da EDIÇÃO, não o do favoritar.
      expect(resultado.whatsapp).toBe("5511911112222");
      expect(api.fornecedores?.[0]).toMatchObject({
        whatsapp: "5511911112222",
        favorito: true,
      });
    });

    it("favoritar a caminho + excluir: o delete sai de verdade", async () => {
      banco.fila.push({
        data: [linha("1", "Alfa"), linha("2", "Beta")],
        error: null,
      });
      await montar();
      const estrela = adiada();
      banco.fila.push(estrela.promessa);
      banco.fila.push({ data: [{ id: "1" }], error: null }); // delete
      let favoritando!: Promise<unknown>;
      let excluindo!: Promise<void>;
      await act(async () => {
        favoritando = api.favoritar("1", true);
        excluindo = api.excluir("1");
        await new Promise((r) => setTimeout(r, 0));
      });
      expect(chamadasDe("delete")).toHaveLength(0);
      await act(async () => {
        estrela.resolver({ data: [linha("1", "Alfa", true)], error: null });
        await favoritando;
        await excluindo;
      });
      expect(chamadasDe("delete")).toHaveLength(1);
      expect(api.fornecedores?.map((f) => f.id)).toEqual(["2"]);
    });

    it("toque duplo na MESMA ação, mesmo enfileirada atrás de outra: continua UMA chamada só", async () => {
      banco.fila.push({ data: [linha("1", "Alfa")], error: null });
      await montar();
      const estrela = adiada();
      banco.fila.push(estrela.promessa);
      banco.fila.push({
        data: [{ ...linha("1", "Alfa", true), cidade: "Recife" }],
        error: null,
      });
      let tudo!: Promise<unknown>;
      await act(async () => {
        tudo = Promise.all([
          api.favoritar("1", true),
          api.editar("1", { cidade: "Recife" }),
          api.editar("1", { cidade: "Recife" }), // 2º toque no Salvar
          api.favoritar("1", true), // 2º toque na estrela
        ]);
        await new Promise((r) => setTimeout(r, 0));
        estrela.resolver({ data: [linha("1", "Alfa", true)], error: null });
        await tudo;
      });
      expect(chamadasDe("update")).toHaveLength(2);
    });

    it("outro fornecedor nunca espera: a estrela do 1 a caminho não segura a edição do 2", async () => {
      banco.fila.push({
        data: [linha("1", "Alfa"), linha("2", "Beta")],
        error: null,
      });
      await montar();
      const estrela = adiada();
      banco.fila.push(estrela.promessa);
      banco.fila.push({ data: [linha("2", "Beta Novo")], error: null });
      let favoritando!: Promise<unknown>;
      await act(async () => {
        favoritando = api.favoritar("1", true);
        await api.editar("2", { nome: "Beta Novo" });
      });
      expect(chamadasDe("update")).toHaveLength(2);
      await act(async () => {
        estrela.resolver({ data: [linha("1", "Alfa", true)], error: null });
        await favoritando;
      });
    });

    it("a primeira ação FALHA: a seguinte roda mesmo assim, com a própria resposta", async () => {
      banco.fila.push({ data: [linha("1", "Alfa")], error: null });
      await montar();
      const estrela = adiada();
      banco.fila.push(estrela.promessa);
      banco.fila.push({ data: [linha("1", "Alfa Novo")], error: null });
      let favoritando!: Promise<unknown>;
      let editando!: Promise<{ nome: string }>;
      await act(async () => {
        favoritando = api.favoritar("1", true);
        favoritando.catch(() => {}); // a falha é esperada aqui
        editando = api.editar("1", { nome: "Alfa Novo" });
        await new Promise((r) => setTimeout(r, 0));
        estrela.resolver({ data: null, error: { message: "Failed to fetch" } });
        await expect(favoritando).rejects.toThrow(/Não consegui falar/);
      });
      let resultado!: { nome: string };
      await act(async () => {
        resultado = await editando;
      });
      expect(resultado.nome).toBe("Alfa Novo");
      expect(chamadasDe("update")).toHaveLength(2);
    });

    it("estrela que terminou ANTES do Salvar não é desfeita: a edição sem `favorito` não manda a estrela", async () => {
      banco.fila.push({ data: [linha("1", "Alfa")], error: null });
      await montar();
      banco.fila.push({ data: [linha("1", "Alfa", true)], error: null });
      await act(async () => {
        await api.favoritar("1", true);
      });
      expect(api.fornecedores?.[0].favorito).toBe(true);
      // A folha abriu com a estrela antiga e o lojista não mexeu nela: a tela manda a edição SEM `favorito`.
      banco.fila.push({
        data: [{ ...linha("1", "Alfa", true), cidade: "Recife" }],
        error: null,
      });
      await act(async () => {
        await api.editar("1", { nome: "Alfa", cidade: "Recife" });
      });
      const updates = chamadasDe("update");
      expect(updates[1].args[0]).not.toHaveProperty("favorito");
      expect(api.fornecedores?.[0]).toMatchObject({
        favorito: true,
        cidade: "Recife",
      });
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

    it("zero linhas NÃO diz excluído: recarrega a lista do servidor e avisa que a lista mudou", async () => {
      banco.fila.push({
        data: [linha("1", "Alfa"), linha("2", "Beta")],
        error: null,
      });
      await montar();
      banco.fila.push({ data: [], error: null }); // delete não apagou nada
      banco.fila.push({ data: [linha("2", "Beta")], error: null }); // a recarga do servidor
      await act(async () => {
        await expect(api.excluir("1")).rejects.toThrow(
          "A lista mudou e este fornecedor não foi excluído por aqui. Atualizei a lista: confira se ele ainda aparece.",
        );
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
      // Sem releitura da linha (maybeSingle): o banco aplica a mesma regra para ler e apagar.
      expect(chamadasDe("maybeSingle")).toHaveLength(0);
      // A lista veio do servidor (duas leituras da lista: a de entrada e a recarga).
      expect(chamadasDe("range")).toHaveLength(2);
      expect(api.fornecedores?.map((f) => f.id)).toEqual(["2"]);
    });

    it("zero linhas e a linha ainda está no servidor (política barrou): a linha fica na lista recarregada", async () => {
      banco.fila.push({ data: [linha("1", "Alfa")], error: null });
      await montar();
      banco.fila.push({ data: [], error: null });
      banco.fila.push({ data: [linha("1", "Alfa")], error: null });
      await act(async () => {
        await expect(api.excluir("1")).rejects.toThrow(/não foi excluído/);
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 0));
      });
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
