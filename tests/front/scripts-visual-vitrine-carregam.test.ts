// Harness visual da vitrine (scripts/visual/vitrine/, frente
// desktop/harness) — este teste NÃO sobe navegador nem faz build: só prova
// que os quatro módulos carregam sem lançar, que as fixtures têm a forma
// esperada e que o núcleo de comparação de pixels (comparar.mjs) acerta um
// par idêntico e recusa um par diferente. Quem sobe Chromium é
// `rodar.mjs` via CLI (ver README.md da pasta) — fora do escopo do `npm
// test` deste repositório de propósito (não há Playwright nas dependências
// declaradas; ver o próprio README para o comando de instalação).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

const PASTA = "../../scripts/visual/vitrine";

describe("scripts/visual/vitrine — módulos carregam sem navegador", () => {
  it("fixtures.mjs exporta um catálogo e uma ficha da loja consistentes", async () => {
    const fixtures = await import(`${PASTA}/fixtures.mjs`);

    expect(Array.isArray(fixtures.PRODUTOS)).toBe(true);
    expect(fixtures.PRODUTOS.length).toBeGreaterThanOrEqual(12);
    // Pelo menos um produto com promoção (preco_original > preco_venda) e um
    // com variação (product_variants não vazio) — os dois estados que o
    // harness promete cobrir na tela de produto.
    expect(
      fixtures.PRODUTOS.some(
        (p: { preco_original: number | null; preco_venda: number }) =>
          typeof p.preco_original === "number" &&
          p.preco_original > p.preco_venda,
      ),
    ).toBe(true);
    expect(
      fixtures.PRODUTOS.some(
        (p: { product_variants: unknown[] }) => p.product_variants.length > 0,
      ),
    ).toBe(true);

    const ficha = fixtures.montarFicha("127.0.0.1", "http://127.0.0.1:5173");
    const analisada = JSON.parse(ficha);
    expect(analisada.schemaVersion).toBe(2);
    expect(analisada.host).toBe("127.0.0.1");
    expect(analisada.conexao.supabaseUrl).toBe(fixtures.ORIGEM_BANCO_FIXTURA);
    expect(typeof analisada.conexao.publishableKey).toBe("string");
    expect(analisada.conexao.publishableKey.length).toBeGreaterThan(0);

    // 20 caracteres [a-z0-9] — o contrato de normalizeSupabaseOrigin
    // (src/lib/storeIdentity.ts) que a ficha precisa satisfazer para o app
    // aceitá-la em vez de recusar como IDENTITY_FICHA_INVALID.
    expect(fixtures.REF_FIXTURA).toMatch(/^[a-z0-9]{20}$/);
  });

  it("rede.mjs exporta as funções que rodar.mjs precisa", async () => {
    const rede = await import(`${PASTA}/rede.mjs`);
    expect(typeof rede.instalarRede).toBe("function");
    expect(typeof rede.criarEstadoDoCliente).toBe("function");

    const estado = rede.criarEstadoDoCliente({
      enderecos: [{ id: "a" }],
      favoritos: [],
      cartItems: [],
      notificacoes: [],
      pedidos: [],
    });
    // Cópia, não a mesma referência — mutar o estado devolvido não pode
    // vazar para a fixture original (rede.mjs muta os arrays in-place em
    // POST/PATCH/DELETE simulados).
    estado.enderecos.push({ id: "b" });
    expect(estado.enderecos).toHaveLength(2);
  });

  it("rodar.mjs carrega e exporta rodarHarness sem subir build nem navegador", async () => {
    // A guarda `ehCli` (comparação com `process.argv[1]`) é o que impede
    // `rodarHarness()` de disparar sozinho ao ser importado — sem ela, este
    // `import` já tentaria rodar `npm run build` e abrir um Chromium.
    const rodar = await import(`${PASTA}/rodar.mjs`);
    expect(typeof rodar.rodarHarness).toBe("function");
  });

  it("comparar.mjs: dois PNGs idênticos dão 0 px de diferença", async () => {
    const { compararDiretorios } = await import(`${PASTA}/comparar.mjs`);
    const dirBase = mkdtempSync(join(tmpdir(), "vitrine-comparar-base-"));
    const dirCand = mkdtempSync(join(tmpdir(), "vitrine-comparar-cand-"));
    try {
      const png = new PNG({ width: 2, height: 2 });
      png.data.fill(200);
      const bytes = PNG.sync.write(png);
      (await import("node:fs")).writeFileSync(
        join(dirBase, "inicio__390.png"),
        bytes,
      );
      (await import("node:fs")).writeFileSync(
        join(dirCand, "inicio__390.png"),
        bytes,
      );

      const resultado = compararDiretorios(dirBase, dirCand);
      expect(resultado.ok).toBe(true);
      expect(resultado.totalComDiff).toBe(0);
      expect(resultado.qualquerDiffCelular).toBe(false);
    } finally {
      rmSync(dirBase, { recursive: true, force: true });
      rmSync(dirCand, { recursive: true, force: true });
    }
  });

  it("comparar.mjs: um pixel diferente numa largura de celular falha (ok:false)", async () => {
    const { compararDiretorios } = await import(`${PASTA}/comparar.mjs`);
    const dirBase = mkdtempSync(join(tmpdir(), "vitrine-comparar-base-"));
    const dirCand = mkdtempSync(join(tmpdir(), "vitrine-comparar-cand-"));
    try {
      const fs = await import("node:fs");
      const branco = new PNG({ width: 2, height: 2 });
      branco.data.fill(255);
      const preto = new PNG({ width: 2, height: 2 });
      preto.data.fill(0);
      fs.writeFileSync(
        join(dirBase, "inicio__390.png"),
        PNG.sync.write(branco),
      );
      fs.writeFileSync(join(dirCand, "inicio__390.png"), PNG.sync.write(preto));

      const resultado = compararDiretorios(dirBase, dirCand, [390]);
      expect(resultado.ok).toBe(false);
      expect(resultado.qualquerDiffCelular).toBe(true);
      expect(resultado.totalComDiff).toBe(1);
    } finally {
      rmSync(dirBase, { recursive: true, force: true });
      rmSync(dirCand, { recursive: true, force: true });
    }
  });
});
