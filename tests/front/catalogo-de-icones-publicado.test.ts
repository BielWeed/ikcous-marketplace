// O arquivo que o painel serve (public/icons/categorias.json) é a cópia exata do catálogo aprovado, cada
// forma passa na MESMA regra da CHECK do banco, e o catálogo nunca entra no pacote de JavaScript.
/* eslint-disable security/detect-non-literal-fs-filename --
   leitura da própria árvore do repositório (caminhos fixos deste teste) */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import {
  FORMA_DE_ICONE,
  TAMANHO_MAXIMO_DA_FORMA,
  formaDeIconeValida,
} from "@/lib/icones-de-categoria";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const ler = (rel: string) => readFileSync(join(RAIZ, rel), "utf8");
const DOCS = JSON.parse(
  ler("docs/design/icones-de-categoria/catalogo.json"),
) as { chave: string; d: string }[];
const PUBLICADO = JSON.parse(ler("public/icons/categorias.json")) as {
  chave: string;
  d: string;
}[];

describe("catálogo publicado", () => {
  it("é igual ao catálogo aprovado (rode docs/design/icones-de-categoria/publicar.mjs se divergir)", () => {
    expect(PUBLICADO).toEqual(DOCS);
  });

  it("toda forma passa na regra do banco e as chaves são únicas", () => {
    const chaves = new Set<string>();
    for (const item of PUBLICADO) {
      expect(formaDeIconeValida(item.d), item.chave).toBe(true);
      expect(item.d.length, item.chave).toBeLessThanOrEqual(360);
      expect(chaves.has(item.chave), `${item.chave} repetida`).toBe(false);
      chaves.add(item.chave);
    }
  });

  it("o cliente e a CHECK do banco usam o MESMO alfabeto e o MESMO limite", () => {
    const sql = ler(
      "supabase/migrations/20261351000000_a_categoria_ganha_a_forma_do_icone.sql",
    );
    const check = sql.split("ADD CONSTRAINT categorias_icone_forma_check")[1];
    const regexDoBanco = check.match(/icone_forma ~ '([^']+)'/)?.[1];
    const limiteDoBanco = check.match(
      /char_length\(icone_forma\) <= (\d+)/,
    )?.[1];
    expect(regexDoBanco).toBe(FORMA_DE_ICONE.source);
    expect(Number(limiteDoBanco)).toBe(TAMANHO_MAXIMO_DA_FORMA);
  });

  it("o service worker NÃO pré-baixa o catálogo (json fora do precache) e nenhum arquivo de src o importa", () => {
    const vite = ler("vite.config.ts");
    const glob = vite.match(/globPatterns:\s*\["([^"]+)"\]/)?.[1] ?? "";
    expect(glob).not.toMatch(/json/);
    const achados: string[] = [];
    const varrer = (pasta: string) => {
      for (const nome of readdirSync(pasta)) {
        const caminho = join(pasta, nome);
        if (statSync(caminho).isDirectory()) varrer(caminho);
        else if (/\.(ts|tsx)$/.test(nome)) {
          const texto = readFileSync(caminho, "utf8");
          if (
            /(?:from|import\()\s*["'][^"']*(?:categorias|catalogo)\.json["']/.test(
              texto,
            )
          )
            achados.push(relative(RAIZ, caminho).split(sep).join("/"));
        }
      }
    };
    varrer(join(RAIZ, "src"));
    expect(achados).toEqual([]);
  });
});

describe("formaDeIconeValida", () => {
  it.each([
    "M0 0",
    "m3 15 4-1 3-5 4 4 5 1q3 1 3 4v2H2v-3q0-2 1-2Z",
    "M12 7v14.5M9 3l3 4 3-4",
    "M1,1 L2,2",
    `M${"1".repeat(399)}`,
  ])("aceita %s", (forma) => {
    expect(formaDeIconeValida(forma)).toBe(true);
  });

  it.each([
    "<script>alert(1)</script>",
    "M0 0<",
    'M0 0"',
    "M0 0'",
    "M0 0&",
    "M0 0;",
    "M0 0:",
    "M0 0(1)",
    "M0 0#fff",
    "M0 0+1",
    "M0 0e5",
    "M0 0\n",
    "M0 0é",
    "javascript:alert(1)",
    "url(#x)",
    "",
    " M0 0",
    "L0 0",
    "0 0",
    `M${"1".repeat(400)}`,
    null,
    undefined,
    42,
    { d: "M0 0" },
  ])("recusa %j", (forma) => {
    expect(formaDeIconeValida(forma)).toBe(false);
  });
});
