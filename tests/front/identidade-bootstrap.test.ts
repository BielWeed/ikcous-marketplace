/* eslint-disable security/detect-non-literal-fs-filename -- Only isolated mkdtemp kits are read, written or removed; production kit paths are never used. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  BootstrapError,
  canonico,
  desfazer,
  executar,
  lerKit,
  montarIdentidade,
  planejar,
} from "../../scripts/identidadeBootstrap";
import type {
  IdentidadeLida,
  Portas,
  Valores,
} from "../../scripts/identidadeBootstrap";
import { createIdentityBuildFixture } from "../../scripts/identityBuildFixture";

const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const valores: Valores = {
  store_name: "Loja Ensaio",
  primary_color: "#18181B",
  secondary_color: "#059669",
  accent_color: "#F4F4F5",
  store_city: null,
  store_state: null,
};
const linhaNula: IdentidadeLida = {
  revision: "0",
  identity: {
    store_name: null,
    store_city: null,
    store_state: null,
    primary_color: null,
    secondary_color: null,
    accent_color: null,
    logo_url: null,
    branding_assets: null,
  },
};

let dir: string;
// Layout do kit A6a real: objetos/<sha256>/<nome-original> e' um DIRETORIO por
// sha com o nome original dentro (nao um arquivo nomeado so' pelo sha) --
// dois paths podem compartilhar sha com nomes diferentes (ver preparar.mjs e
// validar.mjs do kit real).
async function kitSintetico(loja: "ikcous" | "savy" = "ikcous") {
  const fixture = await createIdentityBuildFixture("aurora");
  await fs.mkdir(path.join(dir, loja), { recursive: true });
  await fs.writeFile(
    path.join(dir, "manifesto.json"),
    JSON.stringify({ scope: "local-preparation" }),
  );
  await fs.writeFile(
    path.join(dir, loja, "branding-assets.json"),
    JSON.stringify(fixture.identity.assets),
  );
  for (const file of fixture.files) {
    const nomeOriginal = file.path.split("/")[2];
    await fs.mkdir(path.join(dir, "objetos", file.sha256), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(dir, "objetos", file.sha256, nomeOriginal),
      file.bytes,
    );
  }
  return fixture;
}
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "kit-a6-"));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe("lerKit", () => {
  it("le o mapa de papeis e resolve cada objeto pelo sha256 do path", async () => {
    const fixture = await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    expect(kit.loja).toBe("ikcous");
    expect(kit.objetos.size).toBe(
      new Set(fixture.files.map((f) => f.path)).size,
    );
    const header = kit.objetos.get(fixture.identity.assets.header.path);
    expect(header?.sha256).toBe(fixture.identity.assets.header.sha256);
    expect(header?.mime).toBe(fixture.identity.assets.header.media_type);
  });
  it("recusa objeto cujo conteudo nao bate com o sha256 do path", async () => {
    const fixture = await kitSintetico();
    const header = fixture.identity.assets.header;
    await fs.writeFile(
      path.join(dir, "objetos", header.sha256, header.path.split("/")[2]),
      "corrompido",
    );
    await expect(lerKit(dir, "ikcous")).rejects.toMatchObject({ code: "KIT" });
  });
  it("recusa loja ausente no kit", async () => {
    await kitSintetico("ikcous");
    await expect(lerKit(dir, "savy")).rejects.toMatchObject({ code: "KIT" });
  });
  it("dois paths com o mesmo sha256 e nomes diferentes resolvem para arquivos distintos", async () => {
    // O fixture "aurora" nao produz esse caso sozinho (header e loader sao o
    // MESMO path, deduplicado por lerKit antes de tocar o disco). O kit A6a
    // real tem paths com o mesmo sha e nomes diferentes (ex.: logo.svg e
    // favicon.svg na ikcous) -- injeta um segundo papel manualmente para
    // reproduzir isso: se lerKit voltasse a indexar so' por sha (a linha 124
    // antiga), os dois arquivos colidiriam num so'.
    const fixture = await kitSintetico();
    const favicon = fixture.identity.assets.favicon;
    const nomeAlternativo = "favicon-alternativo.svg";
    const pathAlternativo = `v1/${favicon.sha256}/${nomeAlternativo}`;
    const mapaPath = path.join(dir, "ikcous", "branding-assets.json");
    const brutoAssets = JSON.parse(await fs.readFile(mapaPath, "utf8"));
    brutoAssets.originals.push({ ...favicon, path: pathAlternativo });
    await fs.writeFile(mapaPath, JSON.stringify(brutoAssets));
    await fs.writeFile(
      path.join(dir, "objetos", favicon.sha256, nomeAlternativo),
      await fs.readFile(
        path.join(dir, "objetos", favicon.sha256, favicon.path.split("/")[2]),
      ),
    );
    const kit = await lerKit(dir, "ikcous");
    const original = kit.objetos.get(favicon.path);
    const alternativo = kit.objetos.get(pathAlternativo);
    expect(original?.arquivo).toBeTruthy();
    expect(alternativo?.arquivo).toBeTruthy();
    expect(alternativo?.arquivo).not.toBe(original?.arquivo);
  });
});

describe("montarIdentidade", () => {
  it("monta a linha com logo_url apontando para o header no bucket branding e passa no parseStoreIdentity do build", async () => {
    const fixture = await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    const linha = montarIdentidade(kit, valores, SUPABASE_URL);
    expect(linha.logo_url).toBe(
      `${SUPABASE_URL}/storage/v1/object/public/branding/${fixture.identity.assets.header.path}`,
    );
    expect(linha.store_name).toBe("Loja Ensaio");
    expect(linha.store_city).toBeNull();
    expect(Object.keys(linha).sort()).toEqual([
      "accent_color",
      "branding_assets",
      "logo_url",
      "primary_color",
      "secondary_color",
      "store_city",
      "store_name",
      "store_state",
    ]);
  });
  it("recusa valores que o build recusaria (primaria preta, nome vazio)", async () => {
    await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    expect(() =>
      montarIdentidade(
        kit,
        { ...valores, primary_color: "#000000" },
        SUPABASE_URL,
      ),
    ).toThrow(BootstrapError);
    expect(() =>
      montarIdentidade(kit, { ...valores, store_name: "   " }, SUPABASE_URL),
    ).toThrowError(expect.objectContaining({ code: "VALORES" }));
  });
});

describe("planejar", () => {
  it("banco toda NULL -> bootstrap com todos os objetos unicos do kit", async () => {
    await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    const plano = planejar(desired, linhaNula, kit);
    expect(plano.acao).toBe("bootstrap");
    if (plano.acao === "bootstrap")
      expect(plano.objetos.map((o) => o.path).sort()).toEqual(
        [...kit.objetos.keys()].sort(),
      );
  });
  it("banco identico ao desejado -> nada", async () => {
    await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    expect(
      planejar(desired, { revision: "7", identity: desired }, kit).acao,
    ).toBe("nada");
  });
  it("banco com identidade diferente -> recusa (nunca sobrescreve)", async () => {
    await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    const outra = {
      revision: "3",
      identity: { ...linhaNula.identity, store_name: "Outra Loja" },
    };
    expect(planejar(desired, outra, kit)).toMatchObject({ acao: "recusa" });
  });
});

// Servidor falso: objetos "no bucket" + a linha da view publica, tudo em memoria.
// O tipo do kit vem so' para documentar o chamador (mesma forma de lerKit);
// o corpo desta funcao nunca le o kit direto, so' o que as portas recebem.
function portasFalsas(
  _kit: Awaited<ReturnType<typeof lerKit>>,
  inicial: IdentidadeLida,
) {
  const bucket = new Map<string, { bytes: Uint8Array; mime: string }>();
  let linha = inicial;
  const chamadas: string[] = [];
  const origin = SUPABASE_URL;
  const fetchImpl: typeof fetch = async (input, _init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    if (url.pathname.startsWith("/storage/v1/object/public/branding/")) {
      const objeto = bucket.get(
        url.pathname.slice("/storage/v1/object/public/branding/".length),
      );
      if (!objeto) return new Response("nao existe", { status: 404 });
      // Buffer.from normaliza o tipo para o que o Response aceita como corpo
      // (o mesmo ajuste que identity-build-config.test.ts ja faz para bytes
      // vindos de fixture/leitura de arquivo).
      return new Response(Buffer.from(objeto.bytes), {
        status: 200,
        headers: {
          "content-type": objeto.mime,
          "content-length": String(objeto.bytes.length),
        },
      });
    }
    if (url.pathname === "/rest/v1/v_store_config") {
      // Registrado em `chamadas` para que C1 (a prova final pela porta do
      // consumidor) tenha como provar ORDEM contra "gravar", nao so' contagem.
      chamadas.push("consulta:v_store_config");
      const { identity } = linha;
      return new Response(JSON.stringify([identity]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(`rota inesperada ${url.pathname}`, { status: 500 });
  };
  const portas: Portas = {
    supabaseUrl: origin,
    chavePublica: "sb_publishable_fixture_only",
    fetchImpl,
    banco: {
      async ler() {
        chamadas.push("ler");
        return linha;
      },
      async gravar(rev, expected, desired) {
        chamadas.push("gravar");
        if (
          rev !== linha.revision ||
          canonico(expected) !== canonico(linha.identity)
        )
          throw new BootstrapError("CONFLITO", "IDENTITY_CONFLICT");
        linha = {
          revision: String(Number(linha.revision) + 1),
          identity: desired,
        };
        return linha;
      },
    },
    storage: {
      async subir(objeto) {
        chamadas.push(`subir:${objeto.path}`);
        bucket.set(objeto.path, {
          bytes: await fs.readFile(objeto.arquivo),
          mime: objeto.mime,
        });
      },
      async remover(paths) {
        chamadas.push(`remover:${paths.length}`);
        for (const p of paths) bucket.delete(p);
      },
    },
  };
  return { portas, bucket, chamadas, linha: () => linha };
}

describe("executar", () => {
  it("sem --aplicar nao chama nenhuma porta de escrita", async () => {
    await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    const f = portasFalsas(kit, linhaNula);
    const r = await executar(planejar(desired, linhaNula, kit), f.portas);
    expect(r.revisao).toBeNull();
    expect(r.aplicado).toBe(false);
    expect(
      f.chamadas.filter(
        (c) =>
          c.startsWith("subir") || c === "gravar" || c.startsWith("remover"),
      ),
    ).toEqual([]);
  });
  it("ordem: sobe -> confere -> grava -> prova; devolve revisao nova", async () => {
    await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    const f = portasFalsas(kit, linhaNula);
    const r = await executar(planejar(desired, linhaNula, kit), f.portas, {
      aplicar: true,
    });
    expect(r.acao).toBe("bootstrap");
    expect(r.revisao).toBe("1");
    expect(r.prova).toBe("ok");
    expect(r.aplicado).toBe(true);
    expect(r.subidos.length).toBe(kit.objetos.size);
    const idxGravar = f.chamadas.indexOf("gravar");
    expect(
      f.chamadas.slice(0, idxGravar).filter((c) => c.startsWith("subir"))
        .length,
    ).toBe(kit.objetos.size);
    expect(canonico(f.linha().identity)).toBe(canonico(desired));
  });
  it("prova final consulta a view publica DEPOIS de gravar (nao e' so' um literal)", async () => {
    // C1: `prova: "ok"` era um literal (nucleo:350) sem teste que exigisse a
    // consulta de verdade -- apagar a chamada a provarPeloConsumidor deixava
    // a suite inteira verde. Este teste usa a instrumentacao da rota
    // /rest/v1/v_store_config (portasFalsas, acima) para provar que ela foi
    // chamada, e que foi chamada DEPOIS de "gravar" -- nao so' contada.
    await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    const f = portasFalsas(kit, linhaNula);
    const r = await executar(planejar(desired, linhaNula, kit), f.portas, {
      aplicar: true,
    });
    expect(r.prova).toBe("ok");
    const idxGravar = f.chamadas.indexOf("gravar");
    const idxConsulta = f.chamadas.lastIndexOf("consulta:v_store_config");
    expect(idxConsulta).toBeGreaterThan(idxGravar);
  });
  it("objeto ja no bucket com o mesmo sha e' pulado; com sha diferente recusa antes de subir", async () => {
    await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    const header = kit.objetos.get(kit.assets.header.path);
    if (!header) throw new Error("fixture sem header");
    const f = portasFalsas(kit, linhaNula);
    f.bucket.set(header.path, {
      bytes: await fs.readFile(header.arquivo),
      mime: header.mime,
    });
    const r = await executar(planejar(desired, linhaNula, kit), f.portas, {
      aplicar: true,
    });
    expect(r.pulados).toEqual([header.path]);
    const g = portasFalsas(kit, linhaNula);
    g.bucket.set(header.path, {
      bytes: new TextEncoder().encode("<svg/>"),
      mime: header.mime,
    });
    await expect(
      executar(planejar(desired, linhaNula, kit), g.portas, { aplicar: true }),
    ).rejects.toMatchObject({ code: "UPLOAD" });
    expect(
      g.chamadas.filter((c) => c.startsWith("subir") || c === "gravar"),
    ).toEqual([]);
  });
  it("conferencia publica com MIME errado falha e NAO grava", async () => {
    await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    const f = portasFalsas(kit, linhaNula);
    const subirOriginal = f.portas.storage.subir;
    f.portas.storage.subir = async (objeto) => {
      await subirOriginal(objeto);
      const gravado = f.bucket.get(objeto.path);
      if (!gravado) throw new Error("objeto nao subiu");
      f.bucket.set(objeto.path, { ...gravado, mime: "text/plain" });
    };
    await expect(
      executar(planejar(desired, linhaNula, kit), f.portas, { aplicar: true }),
    ).rejects.toMatchObject({ code: "CONFERENCIA" });
    expect(f.chamadas).not.toContain("gravar");
  });
  it("conflito de revisao no banco vira CONFLITO (nada mais e' feito)", async () => {
    await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    const f = portasFalsas(kit, { ...linhaNula, revision: "5" });
    // Plano lido com revisao 0; banco ja esta em 5.
    const plano = planejar(desired, linhaNula, kit);
    await expect(
      executar(plano, f.portas, { aplicar: true }),
    ).rejects.toMatchObject({ code: "CONFLITO" });
  });
});

describe("desfazer", () => {
  it("exige que o banco tenha exatamente a identidade do kit; grava NULL antes de remover objetos", async () => {
    await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    const f = portasFalsas(kit, linhaNula);
    await executar(planejar(desired, linhaNula, kit), f.portas, {
      aplicar: true,
    });
    const antes = f.chamadas.length;
    const r = await desfazer(kit, valores, f.portas, { aplicar: true });
    expect(r.acao).toBe("desfeito");
    expect(r.aplicado).toBe(true);
    expect(Object.values(f.linha().identity).every((v) => v === null)).toBe(
      true,
    );
    const depois = f.chamadas.slice(antes);
    expect(depois.indexOf("gravar")).toBeLessThan(
      depois.findIndex((c) => c.startsWith("remover")),
    );
    expect(f.bucket.size).toBe(0);
  });
  it("banco com outra identidade -> ESTADO, sem escrita", async () => {
    await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    const f = portasFalsas(kit, {
      revision: "2",
      identity: { ...linhaNula.identity, store_name: "Outra" },
    });
    await expect(
      desfazer(kit, valores, f.portas, { aplicar: true }),
    ).rejects.toMatchObject({ code: "ESTADO" });
    expect(f.chamadas).toEqual(["ler"]);
  });
  it("sem --aplicar nao chama gravar nem remover", async () => {
    // C2: espelha o teste equivalente de `executar` (linha ~292) -- os dois
    // testes de desfazer existentes so' chamavam com { aplicar: true }.
    await kitSintetico();
    const kit = await lerKit(dir, "ikcous");
    const desired = montarIdentidade(kit, valores, SUPABASE_URL);
    const f = portasFalsas(kit, linhaNula);
    await executar(planejar(desired, linhaNula, kit), f.portas, {
      aplicar: true,
    });
    const antes = f.chamadas.length;
    const r = await desfazer(kit, valores, f.portas);
    expect(r.acao).toBe("desfeito");
    expect(r.aplicado).toBe(false);
    expect(
      f.chamadas
        .slice(antes)
        .filter((c) => c === "gravar" || c.startsWith("remover")),
    ).toEqual([]);
    expect(f.bucket.size).toBeGreaterThan(0);
  });
});
