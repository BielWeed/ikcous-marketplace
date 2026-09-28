// Portão de tamanho DIVIDIDO (decisão do dono, 26/09/2026): cliente e painel
// viraram orçamentos separados em `.size-limit.cjs`. Este teste cobre as duas
// partes puras que sustentam a divisão:
//
//   1. `classificarBundle`/`ehFronteiraDoPainel` (`scripts/portaoDividido.ts`)
//      — a busca a partir das raízes do Rollup que decide quem é `cliente` e
//      quem é `painel`, com um bundle FALSO (não builda nada de verdade: o
//      build fixture completo é verificação manual, caro demais para rodar
//      aqui a cada `npm run test:front`).
//   2. `validarClassificacaoContraDisco` (`scripts/validarPortaoDeTamanho.cjs`)
//      — a conferência fail-closed que `.size-limit.cjs` roda antes de medir.
//
// Os casos de `classificarBundle` reproduzem dois achados REAIS do fixture
// build de 26/09/2026 (documentados na docstring de portaoDividido.ts): um
// boundary de UM chunk só (AdminArea.tsx) não basta, porque
// `usePrefetchOnHover.ts` importa cada tela do admin direto do chunk de
// entrada; e checar só `facadeModuleId` não basta, porque
// `experimentalMinChunkSize` funde chunk pequeno num vizinho e zera a
// fachada do resultado. Se qualquer uma regredir, este teste cai.
import { describe, expect, it } from "vitest";
import {
  type ChunkParaClassificar,
  classificarBundle,
  ehFronteiraDoPainel,
} from "../../scripts/portaoDividido";
import { validarClassificacaoContraDisco } from "../../scripts/validarPortaoDeTamanho.cjs";

function chunk(
  parcial: Partial<ChunkParaClassificar> & { fileName: string },
): ChunkParaClassificar {
  return {
    isEntry: false,
    isDynamicEntry: false,
    moduleIds: [],
    imports: [],
    dynamicImports: [],
    ...parcial,
  };
}

describe("ehFronteiraDoPainel", () => {
  it("reconhece o chunk dinâmico cujo módulo inclui AdminArea.tsx", () => {
    expect(
      ehFronteiraDoPainel({
        isDynamicEntry: true,
        moduleIds: ["/repo/src/components/layouts/AdminArea.tsx"],
      }),
    ).toBe(true);
  });

  it("aceita separador de Windows no moduleId", () => {
    expect(
      ehFronteiraDoPainel({
        isDynamicEntry: true,
        moduleIds: ["C:\\repo\\src\\components\\layouts\\AdminArea.tsx"],
      }),
    ).toBe(true);
  });

  it("reconhece uma tela do painel por caminho, mesmo sem passar pelo AdminArea.tsx", () => {
    // Achado real do fixture build de 26/09/2026: `usePrefetchOnHover.ts` tem
    // um `import()` PRÓPRIO para cada tela do admin (hover-prefetch de quem já
    // está no painel) e é importado ESTATICAMENTE em App.tsx — então a
    // entrada alcança "AdminCrmView" DIRETO, sem passar pelo chunk-gate. Um
    // boundary de um chunk só (AdminArea.tsx) não segura essa segunda borda;
    // por isso a fronteira também casa por caminho para as telas.
    expect(
      ehFronteiraDoPainel({
        isDynamicEntry: true,
        moduleIds: ["/repo/src/views/admin/AdminCrmView.tsx"],
      }),
    ).toBe(true);
  });

  it("reconhece um chunk fundido sem fachada própria (moduleIds > 1, todos do painel)", () => {
    // Segundo achado real: `experimentalMinChunkSize` funde `AdminSettingsView`
    // com módulos vizinhos pequenos e o Rollup zera `facadeModuleId` do
    // resultado — só `moduleIds` continua denunciando a origem.
    expect(
      ehFronteiraDoPainel({
        isDynamicEntry: true,
        moduleIds: [
          "/repo/src/components/admin/settings/FormasDePagamentoCard.tsx",
          "/repo/src/views/admin/AdminSettingsView.tsx",
        ],
      }),
    ).toBe(true);
  });

  it("abre exceção só para AdminLoginView — a única tela pública do painel", () => {
    expect(
      ehFronteiraDoPainel({
        isDynamicEntry: true,
        moduleIds: ["/repo/src/views/admin/AdminLoginView.tsx"],
      }),
    ).toBe(false);
  });

  it("recusa chunk que não é dynamic entry, mesmo com módulo do painel", () => {
    expect(
      ehFronteiraDoPainel({
        isDynamicEntry: false,
        moduleIds: ["/repo/src/components/layouts/AdminArea.tsx"],
      }),
    ).toBe(false);
  });

  it("recusa dynamic entry sem nenhum módulo do painel", () => {
    expect(
      ehFronteiraDoPainel({
        isDynamicEntry: true,
        moduleIds: ["/repo/src/views/customer/HomeView.tsx"],
      }),
    ).toBe(false);
  });
});

describe("classificarBundle", () => {
  // Bundle falso com as formas que a decisão do dono precisa distinguir:
  //   - entry                                                    -> cliente
  //   - rota de cliente que importa (lazy) um chunk compartilhado
  //     com o admin                                               -> cliente
  //   - chunk só alcançável através do portão do admin            -> painel
  //   - vendor usado só pelo admin                                -> painel
  //   - tela do admin alcançada DIRETO da entrada (o achado 1 —
  //     usePrefetchOnHover.ts — sem passar pelo AdminArea.tsx)    -> painel
  //   - tela do admin fundida sem facadeModuleId (o achado 2 —
  //     experimentalMinChunkSize)                                 -> painel
  //   - AdminLoginView, mesmo alcançada direto da entrada         -> cliente
  // mais o leitor de código de barras, que fica de fora dos dois.
  const bundle: ChunkParaClassificar[] = [
    chunk({
      fileName: "assets/index-h1.js",
      isEntry: true,
      moduleIds: ["/repo/src/main.tsx"],
      imports: ["assets/vendor-react-h1.js"],
      dynamicImports: [
        "assets/Home-h1.js",
        "assets/AdminArea-h1.js",
        // Achado 1 (26/09/2026): usePrefetchOnHover.ts, estático no entry,
        // tem um import() próprio para CADA tela do admin.
        "assets/AdminSettingsView-h1.js",
        "assets/AdminLoginView-h1.js",
      ],
    }),
    chunk({
      fileName: "assets/vendor-react-h1.js",
    }),
    chunk({
      fileName: "assets/Home-h1.js",
      isDynamicEntry: true,
      moduleIds: ["/repo/src/views/customer/HomeView.tsx"],
      dynamicImports: [
        "assets/vendor-compartilhado-h1.js",
        "assets/leitor-zxing-h1.js",
      ],
    }),
    chunk({
      fileName: "assets/vendor-compartilhado-h1.js",
    }),
    chunk({
      fileName: "assets/leitor-zxing-h1.js",
    }),
    chunk({
      fileName: "assets/AdminArea-h1.js",
      isDynamicEntry: true,
      moduleIds: ["/repo/src/components/layouts/AdminArea.tsx"],
      imports: ["assets/vendor-so-admin-h1.js"],
      dynamicImports: ["assets/AdminCrmView-h1.js"],
    }),
    chunk({
      fileName: "assets/vendor-so-admin-h1.js",
    }),
    chunk({
      fileName: "assets/AdminCrmView-h1.js",
      isDynamicEntry: true,
      moduleIds: ["/repo/src/views/admin/AdminCrmView.tsx"],
      imports: ["assets/vendor-compartilhado-h1.js"],
    }),
    chunk({
      // Achado 2 (26/09/2026): sem facadeModuleId depois da fusão — a
      // classificação PRECISA olhar moduleIds inteiro, não uma "fachada".
      fileName: "assets/AdminSettingsView-h1.js",
      isDynamicEntry: true,
      moduleIds: [
        "/repo/src/components/admin/settings/FormasDePagamentoCard.tsx",
        "/repo/src/views/admin/AdminSettingsView.tsx",
      ],
    }),
    chunk({
      fileName: "assets/AdminLoginView-h1.js",
      isDynamicEntry: true,
      moduleIds: ["/repo/src/views/admin/AdminLoginView.tsx"],
    }),
  ];

  const resultado = classificarBundle(bundle);

  it("põe o chunk de entrada em cliente", () => {
    expect(resultado.cliente).toContain("assets/index-h1.js");
  });

  it("põe a rota de cliente e o que ela importa em cliente", () => {
    expect(resultado.cliente).toContain("assets/Home-h1.js");
    expect(resultado.cliente).toContain("assets/vendor-react-h1.js");
  });

  it("põe em cliente o chunk compartilhado, mesmo usado também pelo admin", () => {
    expect(resultado.cliente).toContain("assets/vendor-compartilhado-h1.js");
  });

  it("põe em painel o chunk só alcançável através do portão do admin", () => {
    expect(resultado.painel).toContain("assets/AdminCrmView-h1.js");
    expect(resultado.cliente).not.toContain("assets/AdminCrmView-h1.js");
  });

  it("põe em painel o próprio chunk de fronteira (AdminArea)", () => {
    expect(resultado.painel).toContain("assets/AdminArea-h1.js");
    expect(resultado.cliente).not.toContain("assets/AdminArea-h1.js");
  });

  it("põe em painel o vendor usado só pelo admin", () => {
    expect(resultado.painel).toContain("assets/vendor-so-admin-h1.js");
    expect(resultado.cliente).not.toContain("assets/vendor-so-admin-h1.js");
  });

  it("põe em painel uma tela do admin alcançada DIRETO da entrada e fundida sem fachada", () => {
    expect(resultado.painel).toContain("assets/AdminSettingsView-h1.js");
    expect(resultado.cliente).not.toContain("assets/AdminSettingsView-h1.js");
  });

  it("mantém AdminLoginView em cliente mesmo alcançada direto da entrada", () => {
    expect(resultado.cliente).toContain("assets/AdminLoginView-h1.js");
    expect(resultado.painel).not.toContain("assets/AdminLoginView-h1.js");
  });

  it("exclui o leitor de código de barras dos dois lados", () => {
    expect(resultado.cliente).not.toContain("assets/leitor-zxing-h1.js");
    expect(resultado.painel).not.toContain("assets/leitor-zxing-h1.js");
  });

  it("marca a versão do esquema e não deixa nenhum chunk de fora ou duplicado", () => {
    expect(resultado.versao).toBe(1);
    const semZxing = bundle
      .map((c) => c.fileName)
      .filter((nome) => !nome.startsWith("assets/leitor-zxing-"));
    expect([...resultado.cliente, ...resultado.painel].sort()).toEqual(
      [...semZxing].sort(),
    );
  });

  it("aceita um predicado de fronteira customizado (função pura, injetável)", () => {
    // Predicado próprio, sem nenhuma relação com AdminArea.tsx: só "b" é
    // fronteira. `classificarBundle` repassa o chunk INTEIRO para o predicado
    // (não só os dois campos que `ehFronteiraDoPainel` usa), então dá para
    // casar por qualquer critério — aqui, pelo nome do arquivo.
    const comFronteiraEmB = classificarBundle(
      [
        chunk({
          fileName: "assets/a.js",
          isEntry: true,
          dynamicImports: ["assets/b.js", "assets/c.js"],
        }),
        chunk({ fileName: "assets/b.js", dynamicImports: ["assets/d.js"] }),
        chunk({ fileName: "assets/c.js" }),
        chunk({ fileName: "assets/d.js" }),
      ],
      (candidato) =>
        (candidato as ChunkParaClassificar).fileName === "assets/b.js",
    );
    // "b" não é atravessado: nem ele, nem "d" (que só existe atrás dele)
    // entram em cliente. "c", alcançado direto da raiz, entra normalmente.
    // `classificarBundle` já devolve as duas listas ordenadas.
    expect(comFronteiraEmB.cliente).toEqual(["assets/a.js", "assets/c.js"]);
    expect(comFronteiraEmB.painel).toEqual(["assets/b.js", "assets/d.js"]);
  });
});

describe("validarClassificacaoContraDisco", () => {
  const classificacaoValida = {
    versao: 1,
    cliente: ["assets/index-h1.js", "assets/Home-h1.js"],
    painel: ["assets/AdminArea-h1.js"],
  };
  const discoBatendo = [
    "assets/index-h1.js",
    "assets/Home-h1.js",
    "assets/AdminArea-h1.js",
  ];

  it("aceita quando cliente ∪ painel é exatamente o disco (sem zxing)", () => {
    expect(
      validarClassificacaoContraDisco(classificacaoValida, discoBatendo),
    ).toEqual({
      cliente: classificacaoValida.cliente,
      painel: classificacaoValida.painel,
    });
  });

  it("recusa classificação ausente", () => {
    expect(() =>
      validarClassificacaoContraDisco(undefined, discoBatendo),
    ).toThrow(/PORTAO_TAMANHO/);
  });

  it("recusa versão de esquema diferente de 1", () => {
    expect(() =>
      validarClassificacaoContraDisco(
        { ...classificacaoValida, versao: 2 },
        discoBatendo,
      ),
    ).toThrow(/PORTAO_TAMANHO/);
  });

  it("recusa cliente e painel não disjuntos", () => {
    expect(() =>
      validarClassificacaoContraDisco(
        { versao: 1, cliente: ["assets/x.js"], painel: ["assets/x.js"] },
        ["assets/x.js"],
      ),
    ).toThrow(/disjuntos/);
  });

  it("recusa classificação desatualizada — disco tem chunk novo (hash mudou)", () => {
    expect(() =>
      validarClassificacaoContraDisco(classificacaoValida, [
        ...discoBatendo,
        "assets/Home-h2.js",
      ]),
    ).toThrow(/desatualizada/);
  });

  it("recusa classificação desatualizada — sobra referência ao chunk antigo", () => {
    expect(() =>
      validarClassificacaoContraDisco(classificacaoValida, [
        "assets/index-h1.js",
        "assets/AdminArea-h1.js",
      ]),
    ).toThrow(/desatualizada/);
  });
});
