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
// 29/09/2026 — decisão do dono (em voz): terceiro grupo `opcional` (chunks
// sob demanda com allowlist restrita a `assets/maplibre-gl-*`, o renderer do
// mapa vetorial dos cartões de endereço) e esquema versao 2. Os tetos de
// cliente (550) e painel (450) NÃO mudaram — este arquivo continuaria
// derrubando qualquer tentativa de mudá-los sem decisão.
//
// 13/10/2026 — onda 2 da PR #712 (decisão do dono de 12/10/2026): o worker do
// MapLibre é um ASSET `.js` do Rollup (não chunk) e ganhou grupo PRÓPRIO,
// `workerDoMapa` (allowlist ancorada, teto de 130 kB), no esquema versao 3.
// E o `opcional` passou a exigir ALCANÇABILIDADE, não só nome: um chunk
// `maplibre-gl-*` importado ESTATICAMENTE por quem a cliente baixa fica em
// `cliente` (achado maior da revisão, `portaoDividido.ts:162`).
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
  type ClassificacaoDoBundle,
  classificarBundle,
  ehFronteiraDoPainel,
} from "../../scripts/portaoDividido";
import {
  type ClassificacaoDoPortao,
  validarClassificacaoContraDisco,
} from "../../scripts/validarPortaoDeTamanho.cjs";

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
  //   - maplibre-gl SÓ por import() dinâmico do cliente           -> opcional
  //   - worker do MapLibre (ASSET .js, não chunk)                 -> workerDoMapa
  // mais o leitor de código de barras, que fica de fora de todos.
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
        // 29/09/2026: o mapa vetorial do cartão de endereço importa o
        // maplibre-gl DINAMICAMENTE — só quando um mapa monta. A allowlist
        // `CHUNKS_OPCIONAIS` o tira de `cliente` e dá teto próprio.
        "assets/maplibre-gl-h1.js",
      ],
    }),
    chunk({
      fileName: "assets/maplibre-gl-h1.js",
      isDynamicEntry: true,
      moduleIds: ["/repo/node_modules/maplibre-gl/dist/maplibre-gl.js"],
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
  // Assets do mesmo build falso: o worker do MapLibre (o Vite o emite com
  // `emitFile({type: "asset"})`, por isso não aparece entre os chunks), o
  // CSS, o binário do leitor e as imagens — só o `.js` em `assets/` conta.
  const assetsDoBundle = [
    "assets/maplibre-gl-worker-h1.js",
    "assets/index-h1.css",
    "assets/zxing_reader-h1.wasm",
    "assets/logo-h1.png",
  ];

  const resultado = classificarBundle(bundle, assetsDoBundle);

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

  it("exclui o leitor de código de barras de todos os grupos", () => {
    for (const grupo of [
      resultado.cliente,
      resultado.painel,
      resultado.opcional,
      resultado.workerDoMapa,
    ])
      expect(grupo).not.toContain("assets/leitor-zxing-h1.js");
  });

  it("põe o chunk do mapa vetorial em `opcional` — fora de cliente e painel (só import() dinâmico)", () => {
    // Decisão do dono 29/09/2026: `maplibre-gl` só é baixado quando um mapa
    // monta; teto próprio (250 kB) em vez de inflar o de cliente.
    expect(resultado.opcional).toEqual(["assets/maplibre-gl-h1.js"]);
    expect(resultado.cliente).not.toContain("assets/maplibre-gl-h1.js");
    expect(resultado.painel).not.toContain("assets/maplibre-gl-h1.js");
  });

  it("põe o worker do mapa (asset .js) em `workerDoMapa` — nunca em cliente, painel ou opcional", () => {
    // Decisão do dono 12/10/2026: orçamento PRÓPRIO de 130 kB para o worker.
    expect(resultado.workerDoMapa).toEqual(["assets/maplibre-gl-worker-h1.js"]);
    expect(resultado.cliente).not.toContain("assets/maplibre-gl-worker-h1.js");
    expect(resultado.painel).not.toContain("assets/maplibre-gl-worker-h1.js");
    expect(resultado.opcional).not.toContain("assets/maplibre-gl-worker-h1.js");
  });

  it("marca a versão 3 do esquema e não deixa nenhum JS de fora ou duplicado", () => {
    expect(resultado.versao).toBe(3);
    const semZxing = [...bundle.map((c) => c.fileName), ...assetsDoBundle]
      .filter((nome) => nome.endsWith(".js"))
      .filter((nome) => !nome.startsWith("assets/leitor-zxing-"));
    expect(
      [
        ...resultado.cliente,
        ...resultado.painel,
        ...resultado.opcional,
        ...resultado.workerDoMapa,
      ].sort(),
    ).toEqual([...semZxing].sort());
  });

  it("o tipo da classificação é o que o validador declara (a .d.cts acompanha o esquema)", () => {
    // Trava de TIPO, cobrada pelo `tsc -b` (tests/front entra no
    // tsconfig.app.json): se a `.d.cts` ficar para trás (como ficou no v1
    // enquanto o JSON já era v2), esta atribuição deixa de compilar.
    const comoOValidadorDeclara: ClassificacaoDoPortao = resultado;
    const comoOPluginGrava: ClassificacaoDoBundle = comoOValidadorDeclara;
    expect(comoOPluginGrava.versao).toBe(3);
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
      [],
      (candidato) =>
        (candidato as ChunkParaClassificar).fileName === "assets/b.js",
    );
    // "b" não é atravessado: nem ele, nem "d" (que só existe atrás dele)
    // entram em cliente. "c", alcançado direto da raiz, entra normalmente.
    // `classificarBundle` já devolve as listas ordenadas.
    expect(comFronteiraEmB.cliente).toEqual(["assets/a.js", "assets/c.js"]);
    expect(comFronteiraEmB.painel).toEqual(["assets/b.js", "assets/d.js"]);
  });
});

describe("classificarBundle — `opcional` exige alcançabilidade SÓ por import() dinâmico, não só o nome", () => {
  // Achado MAIOR da revisão da PR #712 (portaoDividido.ts:162): a allowlist
  // `CHUNKS_OPCIONAIS` olhava SÓ o nome. Se alguém trocasse o `import()` do
  // `AddressCardMap.tsx` por um `import` estático, o chunk `maplibre-gl-*`
  // passaria a viajar com a rota (ou com a entrada) de TODO visitante — e a
  // allowlist o tiraria de `cliente` mesmo assim, escondendo ~228 kB do teto
  // de 550. Grafo sintético: cada caso é o MENOR que exercita a regra.
  const entrada = (
    parcial: Partial<ChunkParaClassificar> = {},
  ): ChunkParaClassificar =>
    chunk({ fileName: "assets/index-h1.js", isEntry: true, ...parcial });
  const mapa = chunk({
    fileName: "assets/maplibre-gl-h1.js",
    isDynamicEntry: true,
    moduleIds: ["/repo/node_modules/maplibre-gl/dist/maplibre-gl.js"],
  });

  it("importado ESTATICAMENTE pela entrada: fica em cliente", () => {
    const r = classificarBundle(
      [entrada({ imports: ["assets/maplibre-gl-h1.js"] }), mapa],
      [],
    );
    expect(r.opcional).toEqual([]);
    expect(r.cliente).toEqual([
      "assets/index-h1.js",
      "assets/maplibre-gl-h1.js",
    ]);
  });

  it("importado ESTATICAMENTE por uma rota da cliente (chunk dinâmico): fica em cliente", () => {
    const r = classificarBundle(
      [
        entrada({ dynamicImports: ["assets/Perfil-h1.js"] }),
        chunk({
          fileName: "assets/Perfil-h1.js",
          isDynamicEntry: true,
          moduleIds: ["/repo/src/views/customer/ProfileView.tsx"],
          imports: ["assets/maplibre-gl-h1.js"],
        }),
        mapa,
      ],
      [],
    );
    expect(r.opcional).toEqual([]);
    expect(r.cliente).toContain("assets/maplibre-gl-h1.js");
  });

  it("dinâmico por um chunk e estático por outro, ambos da cliente: basta o estático — fica em cliente", () => {
    const r = classificarBundle(
      [
        entrada({
          dynamicImports: ["assets/maplibre-gl-h1.js", "assets/Rota-h1.js"],
        }),
        chunk({
          fileName: "assets/Rota-h1.js",
          isDynamicEntry: true,
          imports: ["assets/maplibre-gl-h1.js"],
        }),
        mapa,
      ],
      [],
    );
    expect(r.opcional).toEqual([]);
    expect(r.cliente).toContain("assets/maplibre-gl-h1.js");
  });

  it("vale para QUALQUER chunk com o prefixo, não só o principal do maplibre", () => {
    const r = classificarBundle(
      [
        entrada({ dynamicImports: ["assets/maplibre-gl-h1.js"] }),
        chunk({
          ...mapa,
          imports: ["assets/maplibre-gl-compartilhado-h1.js"],
        }),
        // Pedaço que o Rollup separasse do maplibre: ESTÁTICO a partir de um
        // chunk que a cliente alcança — não é "só dinâmico", fica em cliente.
        chunk({ fileName: "assets/maplibre-gl-compartilhado-h1.js" }),
      ],
      [],
    );
    expect(r.opcional).toEqual(["assets/maplibre-gl-h1.js"]);
    expect(r.cliente).toContain("assets/maplibre-gl-compartilhado-h1.js");
  });

  it("um chunk de ENTRADA com o prefixo fica em cliente, mesmo pedido também por import() (a página o carrega sempre)", () => {
    // O `import()` da entrada principal satisfaz as outras condições (a
    // cliente o alcança, só por dinâmico); o que o segura em `cliente` é ele
    // ser entrada — sem a guarda `!chunk.isEntry` iria para `opcional`.
    const r = classificarBundle(
      [
        entrada({ dynamicImports: ["assets/maplibre-gl-h1.js"] }),
        chunk({ ...mapa, isEntry: true }),
      ],
      [],
    );
    expect(r.opcional).toEqual([]);
    expect(r.cliente).toEqual([
      "assets/index-h1.js",
      "assets/maplibre-gl-h1.js",
    ]);
  });

  it("chunk com o prefixo que é FRONTEIRA do painel, pedido por import() da entrada: vai para painel, não para opcional", () => {
    // Pedido por `dynamicImports` da cliente e nunca por estático — mas a
    // busca não atravessa fronteira, então a cliente não o alcança (é o
    // `is_admin` que libera). Sem a guarda `alcancado.has` iria para
    // `opcional` e sairia do teto do painel.
    const r = classificarBundle(
      [
        entrada({ dynamicImports: ["assets/maplibre-gl-h1.js"] }),
        chunk({
          ...mapa,
          moduleIds: ["/repo/src/views/admin/AdminMapaView.tsx"],
        }),
      ],
      [],
    );
    expect(r.opcional).toEqual([]);
    expect(r.painel).toEqual(["assets/maplibre-gl-h1.js"]);
  });

  it("ciclo ESTÁTICO entre o mapa e outro pedaço: fica em cliente (conservador)", () => {
    // O pedaço só é alcançado através do mapa, mas o importa de volta por
    // `import` estático: a regra não tenta provar que o ciclo inteiro mora
    // atrás do `import()` — basta um estático a partir de um chunk que a
    // cliente alcança para o mapa contar em `cliente`.
    const r = classificarBundle(
      [
        entrada({ dynamicImports: ["assets/maplibre-gl-h1.js"] }),
        chunk({ ...mapa, imports: ["assets/geometria-h1.js"] }),
        chunk({
          fileName: "assets/geometria-h1.js",
          imports: ["assets/maplibre-gl-h1.js"],
        }),
      ],
      [],
    );
    expect(r.opcional).toEqual([]);
    expect(r.cliente).toEqual([
      "assets/geometria-h1.js",
      "assets/index-h1.js",
      "assets/maplibre-gl-h1.js",
    ]);
  });

  it("pedido por import() da cliente E importado estaticamente por chunk do PAINEL: opcional (o estático do painel não conta)", () => {
    // Quem o baixa junto, de forma estática, é só o lojista depois do
    // `is_admin`; para a cliente ele continua sob demanda. Medido uma vez,
    // no teto de `opcional` — nunca fora de teto nenhum.
    const r = classificarBundle(
      [
        entrada({
          dynamicImports: [
            "assets/maplibre-gl-h1.js",
            "assets/AdminArea-h1.js",
          ],
        }),
        chunk({
          fileName: "assets/AdminArea-h1.js",
          isDynamicEntry: true,
          moduleIds: ["/repo/src/components/layouts/AdminArea.tsx"],
          imports: ["assets/maplibre-gl-h1.js"],
        }),
        mapa,
      ],
      [],
    );
    expect(r.opcional).toEqual(["assets/maplibre-gl-h1.js"]);
    expect(r.painel).toEqual(["assets/AdminArea-h1.js"]);
    expect(r.cliente).toEqual(["assets/index-h1.js"]);
  });

  it("alcançável só atrás da fronteira do painel: vai para painel, não para opcional", () => {
    const r = classificarBundle(
      [
        entrada({ dynamicImports: ["assets/AdminArea-h1.js"] }),
        chunk({
          fileName: "assets/AdminArea-h1.js",
          isDynamicEntry: true,
          moduleIds: ["/repo/src/components/layouts/AdminArea.tsx"],
          dynamicImports: ["assets/maplibre-gl-h1.js"],
        }),
        mapa,
      ],
      [],
    );
    expect(r.opcional).toEqual([]);
    expect(r.painel).toContain("assets/maplibre-gl-h1.js");
  });
});

describe("classificarBundle — worker do mapa: allowlist ANCORADA, só para asset", () => {
  const entradaQueImportaOMapa = [
    chunk({
      fileName: "assets/index-h1.js",
      isEntry: true,
      dynamicImports: ["assets/maplibre-gl-h1.js"],
    }),
    chunk({ fileName: "assets/maplibre-gl-h1.js", isDynamicEntry: true }),
  ];

  it.each([
    // Sem hash (nome fixo quebraria o `immutable` do vercel.json).
    "assets/maplibre-gl-worker.js",
    // `.mjs` cru: o que o `?url` sozinho emitiria (sem o shared).
    "assets/maplibre-gl-worker-h1.mjs",
    // Sufixo extra depois do hash.
    "assets/maplibre-gl-worker-h1.min.js",
    // `.js` no MEIO do nome: só a âncora `$` da allowlist o recusa (sem ela,
    // `-h1.js` casaria e um `.mjs` qualquer entraria no teto do worker).
    "assets/maplibre-gl-worker-h1.js.mjs",
    // Outro worker qualquer.
    "assets/outro-worker-h1.js",
    // Em subpasta: a âncora `^assets/maplibre-gl-worker-` não casa.
    "assets/sub/maplibre-gl-worker-h1.js",
  ])(
    "asset JS fora da allowlist (%s) conta em cliente — fail-closed: o teto de 550 reprova alto",
    (nome) => {
      const r = classificarBundle(entradaQueImportaOMapa, [nome]);
      expect(r.workerDoMapa).toEqual([]);
      expect(r.cliente).toContain(nome);
    },
  );

  it("ignora o que não é JS de `assets/` (CSS, wasm, imagem, mapa de fonte, JS fora de assets/) e o leitor zxing", () => {
    const r = classificarBundle(entradaQueImportaOMapa, [
      "assets/index-h1.css",
      "assets/zxing_reader-h1.wasm",
      "assets/logo-h1.png",
      "assets/maplibre-gl-worker-h1.js.map",
      "registerSW.js",
      "assets/leitor-zxing-h1.js",
    ]);
    expect(r.cliente).toEqual(["assets/index-h1.js"]);
    expect(r.painel).toEqual([]);
    expect(r.opcional).toEqual(["assets/maplibre-gl-h1.js"]);
    expect(r.workerDoMapa).toEqual([]);
  });

  it("um CHUNK com o nome do worker não vira worker (a allowlist do worker vale só para asset)", () => {
    const r = classificarBundle(
      [
        chunk({
          fileName: "assets/index-h1.js",
          isEntry: true,
          imports: ["assets/maplibre-gl-worker-h1.js"],
        }),
        chunk({ fileName: "assets/maplibre-gl-worker-h1.js" }),
      ],
      [],
    );
    expect(r.workerDoMapa).toEqual([]);
    expect(r.cliente).toContain("assets/maplibre-gl-worker-h1.js");
  });
});

describe("validarClassificacaoContraDisco", () => {
  const classificacaoValida = {
    versao: 3,
    cliente: ["assets/index-h1.js", "assets/Home-h1.js"],
    painel: ["assets/AdminArea-h1.js"],
    opcional: ["assets/maplibre-gl-h1.js"],
    workerDoMapa: ["assets/maplibre-gl-worker-h1.js"],
  };
  const discoBatendo = [
    "assets/index-h1.js",
    "assets/Home-h1.js",
    "assets/AdminArea-h1.js",
    "assets/maplibre-gl-h1.js",
    "assets/maplibre-gl-worker-h1.js",
  ];
  const semOWorker = discoBatendo.filter(
    (arquivo) => arquivo !== "assets/maplibre-gl-worker-h1.js",
  );
  const semOMapa = discoBatendo.filter(
    (arquivo) => arquivo !== "assets/maplibre-gl-h1.js",
  );

  it("aceita quando cliente ∪ painel ∪ opcional ∪ workerDoMapa é exatamente o disco (sem zxing)", () => {
    const { cliente, painel, opcional, workerDoMapa } =
      validarClassificacaoContraDisco(classificacaoValida, discoBatendo);
    expect({ cliente, painel, opcional, workerDoMapa }).toEqual({
      cliente: classificacaoValida.cliente,
      painel: classificacaoValida.painel,
      opcional: classificacaoValida.opcional,
      workerDoMapa: classificacaoValida.workerDoMapa,
    });
  });

  it("recusa classificação ausente", () => {
    expect(() =>
      validarClassificacaoContraDisco(undefined, discoBatendo),
    ).toThrow(/PORTAO_TAMANHO/);
  });

  it.each([1, 2, 4, "3"])(
    "recusa versão de esquema %j (só a 3 tem o grupo workerDoMapa)",
    (versao) => {
      expect(() =>
        validarClassificacaoContraDisco(
          { ...classificacaoValida, versao },
          discoBatendo,
        ),
      ).toThrow(/PORTAO_TAMANHO/);
    },
  );

  it.each(["cliente", "painel", "opcional", "workerDoMapa"] as const)(
    "recusa classificação versão 3 sem o grupo %s",
    (grupo) => {
      const semOGrupo = Object.fromEntries(
        Object.entries(classificacaoValida).filter(
          ([chave]) => chave !== grupo,
        ),
      );
      expect(() =>
        validarClassificacaoContraDisco(semOGrupo, discoBatendo),
      ).toThrow(/PORTAO_TAMANHO/);
    },
  );

  it("recusa workerDoMapa que não é lista, ou com item que não é texto", () => {
    expect(() =>
      validarClassificacaoContraDisco(
        {
          ...classificacaoValida,
          workerDoMapa: "assets/maplibre-gl-worker-h1.js",
        },
        discoBatendo,
      ),
    ).toThrow(/PORTAO_TAMANHO/);
    expect(() =>
      validarClassificacaoContraDisco(
        { ...classificacaoValida, workerDoMapa: [42] },
        discoBatendo,
      ),
    ).toThrow(/PORTAO_TAMANHO/);
  });

  it("recusa arquivo repetido dentro do workerDoMapa", () => {
    expect(() =>
      validarClassificacaoContraDisco(
        {
          ...classificacaoValida,
          workerDoMapa: [
            "assets/maplibre-gl-worker-h1.js",
            "assets/maplibre-gl-worker-h1.js",
          ],
        },
        discoBatendo,
      ),
    ).toThrow(/repetido/);
  });

  it("recusa cliente e painel não disjuntos", () => {
    expect(() =>
      validarClassificacaoContraDisco(
        {
          versao: 3,
          cliente: ["assets/x.js"],
          painel: ["assets/x.js"],
          opcional: [],
          workerDoMapa: [],
        },
        ["assets/x.js"],
      ),
    ).toThrow(/disjuntos/);
  });

  it("recusa cliente e opcional não disjuntos (chunk contado em dois tetos)", () => {
    expect(() =>
      validarClassificacaoContraDisco(
        {
          ...classificacaoValida,
          cliente: ["assets/maplibre-gl-h1.js"],
          painel: [],
        },
        ["assets/maplibre-gl-h1.js", "assets/maplibre-gl-worker-h1.js"],
      ),
    ).toThrow(/disjuntos/);
  });

  const worker = "assets/maplibre-gl-worker-h1.js";
  it.each([
    [
      "cliente",
      {
        ...classificacaoValida,
        cliente: [...classificacaoValida.cliente, worker],
      },
    ],
    [
      "painel",
      {
        ...classificacaoValida,
        painel: [...classificacaoValida.painel, worker],
      },
    ],
    [
      "opcional",
      {
        ...classificacaoValida,
        opcional: [...classificacaoValida.opcional, worker],
      },
    ],
  ])(
    "recusa workerDoMapa e %s não disjuntos (o worker contado em dois tetos)",
    (_grupo, comOWorkerEmDoisGrupos) => {
      expect(() =>
        validarClassificacaoContraDisco(comOWorkerEmDoisGrupos, discoBatendo),
      ).toThrow(/workerDoMapa não são disjuntos/);
    },
  );

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
        "assets/maplibre-gl-h1.js",
        "assets/maplibre-gl-worker-h1.js",
      ]),
    ).toThrow(/desatualizada/);
  });

  it("recusa o worker no disco que a classificação não conhece (o erro real da onda 1)", () => {
    expect(() =>
      validarClassificacaoContraDisco(classificacaoValida, [
        ...semOWorker,
        "assets/maplibre-gl-worker-h2.js",
      ]),
    ).toThrow(/desatualizada.*maplibre-gl-worker-h2/);
  });

  it("recusa o worker na classificação que não está no disco", () => {
    expect(() =>
      validarClassificacaoContraDisco(classificacaoValida, semOWorker),
    ).toThrow(/desatualizada/);
  });

  // Os dois casos abaixo batem com o disco de propósito: a ÚNICA coisa errada
  // é um grupo do mapa vazio sem o outro — o chunk e o worker só viajam
  // juntos (o `importarRenderer` do AddressCardMap importa os dois). Um sem o
  // outro é renomeação de um lado só ou import que deixou de ser dinâmico.
  it("recusa workerDoMapa VAZIO quando o build tem o chunk do mapa em opcional", () => {
    expect(() =>
      validarClassificacaoContraDisco(
        { ...classificacaoValida, workerDoMapa: [] },
        semOWorker,
      ),
    ).toThrow(
      /workerDoMapa vazio.*`ARQUIVO_DO_WORKER_DO_MAPA` \(scripts\/portaoDividido\.ts\) e é contado em `cliente`/,
    );
  });

  it("recusa opcional VAZIO quando o build tem o worker do mapa (o vice-versa)", () => {
    expect(() =>
      validarClassificacaoContraDisco(
        { ...classificacaoValida, opcional: [] },
        semOMapa,
      ),
    ).toThrow(
      /opcional vazio.*`CHUNKS_OPCIONAIS`, scripts\/portaoDividido\.ts.*contado em `cliente`/,
    );
    // Não acusa causa que pode não ser a verdadeira: no ciclo estático o
    // `import()` continua dinâmico, e a mensagem não pode dizer que "deixou
    // de ser só import() dinâmico".
    let mensagem = "";
    try {
      validarClassificacaoContraDisco(
        { ...classificacaoValida, opcional: [] },
        semOMapa,
      );
    } catch (erro) {
      mensagem = (erro as Error).message;
    }
    expect(mensagem).toMatch(/ciclo/);
    expect(mensagem).not.toMatch(/deixou de ser/);
  });
});
