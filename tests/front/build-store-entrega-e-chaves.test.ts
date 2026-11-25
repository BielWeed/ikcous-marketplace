import path from "node:path";
// delivery(), deliveryProvider() e publicDefineStrings() de
// scripts/buildStore.mjs: o que impede o build de uma loja de sair apontando
// para o backend de OUTRA loja, ou com a chave trocada. Cada linha da tabela é
// uma adulteração de uma condição; todas têm de recusar com o código certo e
// sem deixar version.json. As linhas "isoladas" são montadas para que SÓ a
// condição citada as pegue (as outras guardas ficam satisfeitas), senão o
// defeito de uma linha passaria escondido atrás da guarda vizinha.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHAVE_ANON,
  CHAVE_PUB,
  CHAVE_SINTETICA,
  type Cenario,
  ORIGEM,
  REF,
  type Tipo,
  ausente,
  cenario,
  limparRoots,
  recusa,
} from "./build-store-cenario";

const dubles = vi.hoisted(() => ({
  build: vi.fn(),
  loadEnv: vi.fn(),
  gerarHospedagem: vi.fn(),
  gerarSitemap: vi.fn(),
}));
vi.mock("vite", () => ({ build: dubles.build, loadEnv: dubles.loadEnv }));
vi.mock("../../scripts/hospedagem.mjs", () => ({
  gerarHospedagem: dubles.gerarHospedagem,
}));
vi.mock("../../scripts/sitemap.mjs", () => ({
  gerarSitemap: dubles.gerarSitemap,
}));

beforeEach(() => {
  dubles.build.mockReset();
  dubles.loadEnv.mockReset();
  dubles.gerarHospedagem.mockReset().mockResolvedValue(undefined);
  dubles.gerarSitemap.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await limparRoots();
});

const OUTRA_REF = "zzzzzzzzzzzzzzzzzzzz";
const marcador = (c: Cenario) => path.join(c.saida(), "version.json");

// Move a loja inteira (URL pública, origem da conexão e as duas referências)
// para outra origem, mantendo tudo coerente entre si.
function usarOrigem(
  c: Cenario,
  origem: string,
  ref: string,
  urlPublica = origem,
) {
  c.envelope.connection.origin = origem;
  c.envelope.connection.projectRef = ref;
  c.snapshot.identity.projectRef = ref;
  c.envelope.publicDefines.url = urlPublica;
  c.publicos.url = urlPublica;
}
function usarChaves(
  c: Cenario,
  publicos: { url?: string; publishable: string; anon: string },
  conexao: Record<string, unknown>,
) {
  const url = publicos.url ?? c.envelope.publicDefines.url;
  c.envelope.publicDefines = {
    url,
    publishable: publicos.publishable,
    anon: publicos.anon,
  };
  c.publicos = { ...c.envelope.publicDefines };
  c.envelope.connection = { ...c.envelope.connection, ...conexao };
}

type Caso = [string, Tipo, string, (c: Cenario) => void];
const casos: Caso[] = [
  // ---- formato do envelope
  [
    "fornecedor devolve null",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope = null;
    },
  ],
  [
    "deliveryApiVersion 2",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.deliveryApiVersion = 2;
    },
  ],
  [
    "publicDefines nulo",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.publicDefines = null;
    },
  ],
  [
    "connection nulo",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.connection = null;
    },
  ],
  [
    "envelope com campo extra",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.extra = 1;
    },
  ],
  [
    "snapshot do envelope é de outro commit",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.snapshot = { ...c.snapshot, codeSha: "c".repeat(40) };
    },
  ],
  [
    "publicDefines com quarta chave",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.publicDefines.extra = "";
    },
  ],
  [
    "publicDefines.url não é texto",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.publicDefines.url = 5;
    },
  ],
  [
    "publicDefines.publishable não é texto",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.publicDefines.publishable = 5;
    },
  ],
  [
    "publicDefines.anon não é texto",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.publicDefines.anon = 5;
    },
  ],
  // ---- define cru x envelope
  [
    "define da URL difere da entrega",
    "database",
    "DELIVERY_DEFINES",
    (c) => {
      c.publicos.url = `${ORIGEM}x`;
    },
  ],
  [
    "define da publishable difere da entrega",
    "database",
    "DELIVERY_DEFINES",
    (c) => {
      c.publicos.publishable = "outra-chave";
    },
  ],
  [
    "define da anon difere da entrega",
    "database",
    "DELIVERY_DEFINES",
    (c) => {
      c.publicos.anon = "outra-chave";
    },
  ],
  [
    "define da URL ausente",
    "database",
    "DELIVERY_DEFINES",
    (c) => {
      c.ajustarConfig = (cfg) => {
        Reflect.deleteProperty(cfg.define, "import.meta.env.VITE_SUPABASE_URL");
      };
    },
  ],
  [
    "define da publishable ausente",
    "database",
    "DELIVERY_DEFINES",
    (c) => {
      c.ajustarConfig = (cfg) => {
        Reflect.deleteProperty(
          cfg.define,
          "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY",
        );
      };
    },
  ],
  [
    "define da anon ausente",
    "database",
    "DELIVERY_DEFINES",
    (c) => {
      c.ajustarConfig = (cfg) => {
        Reflect.deleteProperty(
          cfg.define,
          "import.meta.env.VITE_SUPABASE_ANON_KEY",
        );
      };
    },
  ],
  [
    "define da anon não é texto",
    "database",
    "DELIVERY_DEFINES",
    (c) => {
      c.ajustarConfig = (cfg) => {
        cfg.define["import.meta.env.VITE_SUPABASE_ANON_KEY"] = 5;
      };
    },
  ],
  [
    "define import.meta.env inteiro (apaga os três)",
    "database",
    "DELIVERY_ENV",
    (c) => {
      c.ajustarConfig = (cfg) => {
        cfg.define["import.meta.env"] = "{}";
      };
    },
  ],
  // ---- fonte x tipo de conexão
  [
    "fixture com conexão database",
    "fixture-none",
    "DELIVERY_SOURCE",
    (c) => {
      c.envelope.connection = envelopeBancoMinimo();
    },
  ],
  [
    "database com conexão fixture-none",
    "database",
    "DELIVERY_SOURCE",
    (c) => {
      c.envelope.connection = { kind: "fixture-none" };
    },
  ],
  [
    "tipo de conexão desconhecido num build fixture",
    "fixture-none",
    "DELIVERY_SOURCE",
    (c) => {
      c.envelope.connection = { kind: "inventada" };
    },
  ],
  [
    "tipo de conexão desconhecido num build database",
    "database",
    "DELIVERY_SOURCE",
    (c) => {
      c.envelope.connection = { kind: "inventada" };
    },
  ],
  // ---- fixture-none
  [
    "fixture-none com campo extra na conexão",
    "fixture-none",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.connection.extra = 1;
    },
  ],
  [
    "fixture-none com URL preenchida",
    "fixture-none",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.publicDefines.url = "x";
      c.publicos.url = "x";
    },
  ],
  [
    "fixture-none com publishable preenchida",
    "fixture-none",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.publicDefines.publishable = "x";
      c.publicos.publishable = "x";
    },
  ],
  [
    "fixture-none com anon preenchida",
    "fixture-none",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.publicDefines.anon = "x";
      c.publicos.anon = "x";
    },
  ],
  // ---- origem pública (regex) e referência do projeto
  [
    "origem em http",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      usarOrigem(c, `http://${REF}.supabase.co`, REF);
    },
  ],
  [
    "origem com 19 caracteres de referência",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      usarOrigem(c, `https://${REF.slice(1)}.supabase.co`, REF.slice(1));
    },
  ],
  [
    "origem com 21 caracteres de referência",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      usarOrigem(c, `https://${REF}a.supabase.co`, `${REF}a`);
    },
  ],
  [
    "origem com referência em maiúsculas",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      usarOrigem(
        c,
        `https://${REF.toUpperCase()}.supabase.co`,
        REF.toUpperCase(),
      );
    },
  ],
  [
    "origem com barra no fim (conexão guarda SEM barra)",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      usarOrigem(c, `${ORIGEM}/`, REF);
    },
  ],
  [
    "origem com sufixo de outro domínio",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      usarOrigem(c, `${ORIGEM}.evil.example`, REF);
    },
  ],
  [
    "origem com texto antes do https",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      usarOrigem(c, `x${ORIGEM}`, REF);
    },
  ],
  [
    "origem em outro domínio supabase",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      usarOrigem(c, `https://${REF}.supabase.io`, REF);
    },
  ],
  [
    "origem em outro provedor .co",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      usarOrigem(c, `https://${REF}.outra.co`, REF);
    },
  ],
  [
    "origem com o ponto de 'supabase' trocado",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      usarOrigem(c, `https://${REF}.supabaseXco`, REF);
    },
  ],
  [
    "origem com o ponto antes de 'supabase' trocado",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      usarOrigem(c, `https://${REF}Xsupabase.co`, REF);
    },
  ],
  [
    "origem não é texto",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.connection.origin = null;
    },
  ],
  [
    "projectRef da conexão é de outra loja",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.connection.projectRef = OUTRA_REF;
    },
  ],
  [
    "projectRef da identidade é de outra loja",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.snapshot.identity.projectRef = OUTRA_REF;
    },
  ],
  [
    "URL pública de OUTRA loja (conexão ainda na original)",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.publicDefines.url = `https://${OUTRA_REF}.supabase.co`;
      c.publicos.url = c.envelope.publicDefines.url;
    },
  ],
  [
    "URL pública com duas barras no fim",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.publicDefines.url = `${ORIGEM}//`;
      c.publicos.url = c.envelope.publicDefines.url;
    },
  ],
  // ---- chaves
  [
    "chave da conexão vazia e defines vazios",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      usarChaves(c, { publishable: "", anon: "" }, { key: "" });
    },
  ],
  [
    "chave da conexão não é a dos defines",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.connection.key = "outra-chave";
    },
  ],
  [
    "anon preenchida além da publishable (concatenação difere da chave)",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      usarChaves(
        c,
        { publishable: CHAVE_PUB, anon: CHAVE_ANON },
        { key: CHAVE_PUB },
      );
    },
  ],
  [
    "keyClass desconhecida (chave partida em duas, só a classe denuncia)",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      usarChaves(
        c,
        { publishable: "parte-a", anon: "parte-b" },
        { key: "parte-bparte-a", keyClass: "outra" },
      );
    },
  ],
  [
    "classe publishable, mas a chave é a anon (partida; só a 1ª comparação de classe pega)",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      usarChaves(
        c,
        { publishable: "b", anon: "sb_publishable_a" },
        { key: "sb_publishable_ab", keyClass: "publishable" },
      );
    },
  ],
  [
    "classe anon-jwt, mas a chave é a publishable (partida; só a 2ª comparação de classe pega)",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      usarChaves(
        c,
        { publishable: "b", anon: "sb_publishable_a" },
        { key: "sb_publishable_ab", keyClass: "anon-jwt" },
      );
    },
  ],
  [
    "classe publishable sem o prefixo sb_publishable_",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      usarChaves(
        c,
        { publishable: "eyJ-chave-de-teste", anon: "" },
        { key: "eyJ-chave-de-teste", keyClass: "publishable" },
      );
    },
  ],
  [
    "classe anon-jwt com a chave nos defines da publishable",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.connection.keyClass = "anon-jwt";
    },
  ],
  [
    "keySource fora da lista",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.connection.keySource = "OUTRA";
    },
  ],
  [
    "keySource ausente",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      Reflect.deleteProperty(c.envelope.connection, "keySource");
    },
  ],
  [
    "conexão database com campo extra",
    "database",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.connection.extra = 1;
    },
  ],
  // ---- sintético
  [
    "sintético com origem VÁLIDA de outra loja (tudo coerente)",
    "fixture-synthetic",
    "DELIVERY_SHAPE",
    (c) => {
      usarOrigem(c, `https://${OUTRA_REF}.supabase.co`, OUTRA_REF);
    },
  ],
  [
    "sintético com chave diferente do par A6 (coerente nos defines)",
    "fixture-synthetic",
    "DELIVERY_SHAPE",
    (c) => {
      usarChaves(
        c,
        { publishable: "outra-chave-sintetica", anon: "" },
        { key: "outra-chave-sintetica" },
      );
    },
  ],
  [
    "sintético com URL pública de outra loja nos defines",
    "fixture-synthetic",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.publicDefines.url = `https://${OUTRA_REF}.supabase.co`;
      c.publicos.url = c.envelope.publicDefines.url;
    },
  ],
  [
    "sintético com a chave do par A6 vinda da anon (publishable vazia)",
    "fixture-synthetic",
    "DELIVERY_SHAPE",
    (c) => {
      usarChaves(c, { publishable: "", anon: CHAVE_SINTETICA }, {});
    },
  ],
  [
    "sintético com campo extra na conexão",
    "fixture-synthetic",
    "DELIVERY_SHAPE",
    (c) => {
      c.envelope.connection.extra = 1;
    },
  ],
];

function envelopeBancoMinimo() {
  return {
    kind: "database",
    origin: ORIGEM,
    projectRef: REF,
    key: CHAVE_PUB,
    keyClass: "publishable",
    keySource: "VITE_SUPABASE_PUBLISHABLE_KEY",
  };
}

describe("delivery(): entrega que não bate com a loja nunca confirma", () => {
  it.each(casos)("%s", async (_nome, tipo, codigo, adulterar) => {
    const c = await cenario(dubles, tipo);
    adulterar(c);
    await recusa(c.executar(), codigo);
    await ausente(marcador(c));
    expect(dubles.gerarHospedagem).not.toHaveBeenCalled();
    expect(dubles.gerarSitemap).not.toHaveBeenCalled();
  });
});

describe("fornecedor da entrega", () => {
  const semApi = { name: "sem-api" };
  const outraApi = { name: "outro", api: { name: "outra-coisa", version: 1 } };

  it("plugins sem api e com api de outro nome são ignorados; só um fornecedor vale", async () => {
    const c = await cenario(dubles);
    c.plugins = [semApi, outraApi, null, c.provider];
    await c.executar();
  });

  it.each([
    ["nenhum fornecedor", () => [semApi], "DELIVERY_PROVIDER"],
    ["só plugin de outro nome", () => [outraApi], "DELIVERY_PROVIDER"],
    ["lista vazia", () => [], "DELIVERY_PROVIDER"],
    [
      "dois fornecedores",
      (c: Cenario) => [c.provider, c.provider],
      "DELIVERY_PROVIDER",
    ],
    [
      "versão 2 do getter",
      (c: Cenario) => [
        { ...c.provider, api: { ...c.provider.api, version: 2 } },
      ],
      "DELIVERY_VERSION",
    ],
    [
      "versão como texto '1'",
      (c: Cenario) => [
        { ...c.provider, api: { ...c.provider.api, version: "1" } },
      ],
      "DELIVERY_VERSION",
    ],
    [
      "get não é função",
      (c: Cenario) => [{ ...c.provider, api: { ...c.provider.api, get: 5 } }],
      "DELIVERY_VERSION",
    ],
  ])("%s recusa", async (_nome, montar, codigo) => {
    const c = await cenario(dubles);
    c.plugins = (montar as (c: Cenario) => unknown[])(c);
    await recusa(c.executar(), codigo as string);
    await ausente(marcador(c));
  });
});

describe("a entrega que o build aceitou é uma cópia congelada", () => {
  it("o getter pode devolver sempre o mesmo objeto: a hospedagem recebe cópia, não ele", async () => {
    const c = await cenario(dubles);
    await c.executar();
    const entrega = dubles.gerarHospedagem.mock.calls[0]?.[1];
    expect(entrega).not.toBe(c.envelope);
    expect(Object.isFrozen(entrega)).toBe(true);
    expect(() => {
      entrega.connection.key = "x";
    }).not.toThrow();
    expect(c.envelope.connection.key).toBe(CHAVE_PUB);
  });
});
