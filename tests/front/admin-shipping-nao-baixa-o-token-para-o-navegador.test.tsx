// @vitest-environment jsdom
//
// Achado AdminShippingView-126 (severidade "antes de crescer", segurança):
// `fetchCreds` fazia `select("*")` em `store_shipping_credentials` e
// guardava o JSON inteiro — token da conta real do Melhor Envio/Frenet
// incluído — no estado React, só para acender "conectado"/"desconectado"
// na faixa-resumo e na seção "Fora da cidade". A tela declara em três
// lugares que NUNCA grava credencial; ela também não precisa LER o token
// para saber SE ele existe.
//
// A correção não pede RPC nem migration (ambos fora do escopo desta
// tarefa — arquivos_permitidos não inclui supabase/migrations): o filtro
// `credentials->>token is not null` roda no PRÓPRIO Postgres antes de
// responder, e a coluna `credentials` some da lista de `select`. O
// navegador recebe só `provider` das linhas que passaram no filtro — o
// token nunca sai do banco.
//
// Este teste prende as DUAS metades do achado:
//   1. a consulta pedida ao Supabase nunca inclui a coluna `credentials`
//      (o `select` some, mesmo que o mock devolva um token de propósito);
//   2. o comportamento visível continua correto: com token real, a tela
//      diz "conectado"; com `credentials: {}` (linha sem token, criada por
//      quem salva a transportadora antes de preencher a chave), continua
//      "desconectado".
//
// Contra o HEAD antes da correção, o teste 1 reprova: `colunasPedidas`
// chega como "*", que inclui `credentials`.
//
// AJUSTE DA 1.5.5: com a SuperFrete salva, a tela faz uma segunda leitura que
// pede SÓ o e-mail de contato técnico por alias
// (`contato:credentials->>contact_email`, com `.eq("provider", …)`) — sem
// ele a edge não cota, e a tela passa a dizer "incompleta" (teste próprio em
// admin-frete-superfrete-email-incompleta.test.tsx). Aqui o mini-PostgREST
// ganhou `.eq` e a projeção por alias, a asserção de colunas passou a aceitar
// só esse caminho (e continua recusando a coluna inteira, "*" e token), e o
// caso "chave salva" da SuperFrete ganhou o e-mail na linha salva.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { TOKEN_REAL, mockConfig, estadoDoBanco } = vi.hoisted(() => {
  // Variável local de verdade (não propriedade de objeto): dentro da MESMA
  // função, `TOKEN_REAL` já existe quando `estadoDoBanco` é montado —
  // diferente de um objeto literal, onde uma chave não enxerga a outra.
  const TOKEN_REAL = "tok-conta-real-do-melhor-envio-nao-pode-viajar-a-toa";
  return {
    TOKEN_REAL,
    mockConfig: {
      shippingProvider: "melhor_envio" as
        | "flat_fee"
        | "melhor_envio"
        | "frenet"
        | "superfrete",
      shippingCoverage: "national" as "local" | "national",
    },
    // `linhas` é o que a tabela "teria" — o mock aplica o mesmo filtro que
    // a implementação pede, para o teste 2 provar que o comportamento
    // visível não regrediu junto com a correção de segurança.
    estadoDoBanco: {
      linhas: [
        { provider: "melhor_envio", credentials: { token: TOKEN_REAL } },
      ] as Array<{ provider: string; credentials: Record<string, unknown> }>,
      colunasPedidas: "",
      // 1.5.5: TODAS as projeções pedidas, na ordem (a tela pode fazer mais
      // de uma leitura; `colunasPedidas` guarda só a última).
      todasAsColunas: [] as string[],
    },
  };
});

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));

// Simula o essencial do query builder do PostgREST: `.not(coluna, "is",
// null)` e `.neq(coluna, valor)` filtram no "banco" (aqui, em memória) —
// exatamente como o Postgres real filtraria por `credentials->>token`
// antes de montar a resposta. O ponto do teste 1 é `colunasPedidas`: se a
// implementação voltar a pedir `"*"` ou qualquer string que contenha
// `credentials`, o teste reprova ali, sem nem chegar a olhar o filtro.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "store_shipping_credentials") {
        return {
          select: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        };
      }

      // `Object.assign` sobre um Promise DE VERDADE (não um objeto com
      // `then` próprio, que o Biome recusa como thenable disfarçado): o
      // `.not`/`.neq` são métodos extras pendurados num Promise real, do
      // mesmo jeito que o builder de verdade do PostgREST encadeia filtro
      // e ainda é `await`ável no fim.
      //
      // Tipo nomeado (em vez de `ReturnType<typeof aplicarFiltros>` dentro
      // da própria assinatura): a função é recursiva, e o TS não infere o
      // tipo de retorno de uma função a partir dela mesma (TS7022).
      type Consulta = Promise<{ data: unknown; error: null }> & {
        not: (coluna: string, op: string, valor: unknown) => Consulta;
        neq: (coluna: string, valor: unknown) => Consulta;
        eq: (coluna: string, valor: unknown) => Consulta;
      };
      const aplicarFiltros = (
        linhas: typeof estadoDoBanco.linhas,
        pedidas: string,
      ): Consulta => {
        const projetadas = linhas.map((l) => {
          const colunas = pedidas.split(",").map((c) => c.trim());
          const linhaProjetada: Record<string, unknown> = {};
          for (const c of colunas) {
            if (c === "provider") linhaProjetada.provider = l.provider;
            // 1.5.5: alias `nome:credentials->>campo` devolve SÓ o campo.
            const alias = /^(\w+):credentials->>(\w+)$/.exec(c);
            if (alias) {
              const v = l.credentials?.[alias[2]];
              linhaProjetada[alias[1]] = v == null ? null : String(v);
            }
            // Qualquer outra coluna pedida (ex.: "credentials", "*") "vaza"
            // a credencial de propósito — é isto que o teste 1 teria de
            // pegar via `colunasPedidas`.
            if (c === "credentials" || c === "*") {
              linhaProjetada.credentials = l.credentials;
            }
          }
          return linhaProjetada;
        });
        return Object.assign(
          Promise.resolve({ data: projetadas, error: null }),
          {
            not(coluna: string, _op: string, _valor: unknown) {
              return aplicarFiltros(
                coluna === "credentials->>token"
                  ? linhas.filter((l) => l.credentials?.token != null)
                  : linhas,
                pedidas,
              );
            },
            neq(coluna: string, valor: unknown) {
              return aplicarFiltros(
                coluna === "credentials->>token"
                  ? linhas.filter((l) => l.credentials?.token !== valor)
                  : linhas,
                pedidas,
              );
            },
            // 1.5.5: a leitura do e-mail filtra por `provider`.
            eq(coluna: string, valor: unknown) {
              return aplicarFiltros(
                coluna === "provider"
                  ? linhas.filter((l) => l.provider === valor)
                  : linhas,
                pedidas,
              );
            },
          },
        );
      };

      return {
        select: (colunas: string) => {
          estadoDoBanco.colunasPedidas = colunas;
          estadoDoBanco.todasAsColunas.push(colunas);
          return aplicarFiltros(estadoDoBanco.linhas, colunas);
        },
      };
    },
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("AdminShippingView — não baixa o token da transportadora para o navegador", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.shippingProvider = "melhor_envio";
    mockConfig.shippingCoverage = "national";
    estadoDoBanco.linhas = [
      { provider: "melhor_envio", credentials: { token: TOKEN_REAL } },
    ];
    estadoDoBanco.colunasPedidas = "";
    estadoDoBanco.todasAsColunas = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrirTela() {
    const { AdminShippingView } = await import(
      "@/views/admin/AdminShippingView"
    );
    await act(async () => {
      raiz.render(<AdminShippingView active={true} onSetDirty={vi.fn()} />);
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  it("a consulta a store_shipping_credentials nunca pede a coluna credentials (o token não sai do banco)", async () => {
    await abrirTela();

    expect(estadoDoBanco.colunasPedidas).not.toMatch(/credentials/);
    expect(estadoDoBanco.colunasPedidas).not.toBe("*");
  });

  it("o token de verdade nunca aparece em lugar nenhum do DOM renderizado", async () => {
    await abrirTela();

    expect(hospedeiro.innerHTML).not.toContain(TOKEN_REAL);
  });

  it("com token real cadastrado, a tela ainda diz 'conectado' (o comportamento não regrediu)", async () => {
    await abrirTela();

    expect(hospedeiro.textContent).toMatch(/Melhor Envio conectado/i);
  });

  it("SuperFrete (1.5.4): com token salvo a tela diz 'chave salva' — NUNCA 'conectado' nem 'preço real' (chave salva não prova conexão)", async () => {
    // Revisão da 1.5.4: a chave salva não prova que a SuperFrete responde.
    // Quem prova é o "Testar" em Ajustes; esta tela só diz o que sabe.
    // 1.5.5: "chave salva" exige também o e-mail de contato técnico salvo
    // (sem ele o estado é "incompleta" — teste próprio).
    mockConfig.shippingProvider = "superfrete";
    estadoDoBanco.linhas = [
      {
        provider: "superfrete",
        credentials: { token: TOKEN_REAL, contact_email: "loja@ex.com" },
      },
    ];
    await abrirTela();

    for (const colunas of estadoDoBanco.todasAsColunas) {
      expect(
        colunas.replace(/\w+:credentials->>contact_email/g, ""),
      ).not.toMatch(/credentials/);
      expect(colunas).not.toMatch(/token|\*/);
    }
    expect(hospedeiro.innerHTML).not.toContain(TOKEN_REAL);
    const texto = hospedeiro.textContent ?? "";
    // Sem fronteira de palavra: o textContent cola os blocos
    // ("…cidadeconectado"). Neste estado nem "desconectado" aparece.
    expect(texto).not.toMatch(/conectado/i);
    expect(texto).not.toMatch(/preço real/i);
    expect(texto).toMatch(/chave salva/i);
    expect(texto).toContain(
      "Chave da SuperFrete salva — confirme a conexão com 'Testar' em Ajustes > Transportadoras.",
    );
  });

  it("controle: Melhor Envio com token salvo continua EXATAMENTE como antes (conectado + preço real)", async () => {
    await abrirTela();

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toMatch(/Melhor Envio conectado/);
    expect(texto).toContain(
      "Conectado ao Melhor Envio — PAC e SEDEX com preço real, na hora.",
    );
    expect(texto).not.toMatch(/chave salva/i);
  });

  it("SuperFrete sem token salvo NUNCA diz 'conectado'", async () => {
    mockConfig.shippingProvider = "superfrete";
    estadoDoBanco.linhas = [{ provider: "superfrete", credentials: {} }];
    await abrirTela();

    expect(hospedeiro.textContent).not.toMatch(/SuperFrete conectado/i);
    expect(hospedeiro.textContent).not.toMatch(/Conectado ao SuperFrete/i);
    // E o nome aparece (a frase é "conecte o SuperFrete", não a genérica).
    expect(hospedeiro.textContent).toMatch(/conecte o SuperFrete/);
  });

  it("com linha sem token (credentials: {}), a tela diz 'desconectado' — presença de linha não basta", async () => {
    estadoDoBanco.linhas = [{ provider: "melhor_envio", credentials: {} }];
    await abrirTela();

    expect(hospedeiro.textContent).not.toMatch(/Melhor Envio conectado/i);
  });
});
