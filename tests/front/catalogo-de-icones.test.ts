// O catálogo de ícones do painel: leitura segura do JSON, busca sem acento, sugestão pelo nome da
// categoria e a busca por fetch (cache, falha, resposta que não é o catálogo).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  URL_DO_CATALOGO,
  buscarNoCatalogo,
  carregarCatalogo,
  catalogoEmMemoria,
  esquecerOCatalogoCarregado,
  gruposDoCatalogo,
  lerCatalogo,
  sugerirPeloNome,
} from "@/lib/catalogo-de-icones";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CATALOGO_BRUTO: unknown = JSON.parse(
  readFileSync(
    join(__dirname, "..", "..", "public", "icons", "categorias.json"),
    "utf8",
  ),
);
const CATALOGO = lerCatalogo(CATALOGO_BRUTO);
const chaveSugerida = (nome: string) => {
  const s = sugerirPeloNome(CATALOGO, nome);
  if (!s) return null;
  return s.tipo === "catalogo" ? s.item.chave : `classico:${s.chave}`;
};

describe("lerCatalogo", () => {
  it("aceita o catálogo inteiro que o painel serve", () => {
    expect(CATALOGO.length).toBeGreaterThanOrEqual(90);
    expect(gruposDoCatalogo(CATALOGO)).toHaveLength(11);
  });

  it("descarta item com forma fora do alfabeto do banco, sem nome ou com chave repetida", () => {
    const ok = {
      chave: "a",
      nome: "A",
      grupo: "G",
      palavras: ["a"],
      d: "M0 0",
    };
    const lista = lerCatalogo([
      ok,
      { ...ok, chave: "a" }, // chave repetida
      { ...ok, chave: "b", d: "<script>alert(1)</script>" },
      { ...ok, chave: "c", d: "M0 0 L1 1 url(#x)" },
      { ...ok, chave: "d", d: "L0 0" }, // não começa por M
      { ...ok, chave: "e", d: `M${"1".repeat(400)}` }, // 401 caracteres
      { ...ok, chave: "f", nome: "  " },
      { ...ok, chave: "g", grupo: "" },
      { ...ok, chave: "h", d: 5 },
      null,
      "texto",
    ]);
    expect(lista.map((i) => i.chave)).toEqual(["a"]);
  });

  it("palavras ausentes viram lista vazia", () => {
    const lista = lerCatalogo([
      { chave: "a", nome: "A", grupo: "G", d: "M0 0" },
    ]);
    expect(lista[0].palavras).toEqual([]);
  });

  it("recusa o que não é lista ou não tem nenhum item aproveitável (a página inicial no lugar do arquivo)", () => {
    expect(() => lerCatalogo({ chave: "a" })).toThrow();
    expect(() => lerCatalogo(null)).toThrow();
    expect(() => lerCatalogo([])).toThrow();
    expect(() => lerCatalogo([{ chave: "x", d: "<svg>" }])).toThrow();
  });
});

describe("buscarNoCatalogo", () => {
  it("sem termo devolve tudo; acha por nome, palavra, sem acento e com plural", () => {
    expect(buscarNoCatalogo(CATALOGO, "  ")).toHaveLength(CATALOGO.length);
    const chaves = (t: string) =>
      buscarNoCatalogo(CATALOGO, t).map((i) => i.chave);
    expect(chaves("tenis")).toContain("tenis");
    expect(chaves("TÊNIS")).toContain("tenis");
    expect(chaves("calcas")).toContain("calca");
    expect(chaves("calça")).toContain("calca");
    expect(chaves("biquínis")).toContain("biquini");
    // todas as palavras precisam aparecer
    expect(chaves("calca social")).toContain("calca");
    expect(chaves("calca xyzxyz")).toEqual([]);
    expect(chaves("zzzzzz")).toEqual([]);
  });
});

describe("sugerirPeloNome", () => {
  it.each([
    ["Blusa", "blusa"],
    ["Blusas", "blusa"],
    ["Body", "body"],
    ["Bodies", "body"],
    ["Calça", "calca"],
    ["Calças", "calca"],
    ["CALÇAS FEMININAS", "calca"],
    ["Saia", "saia"],
    ["Saias midi", "saia"],
    ["Vestidos", "vestido"],
    ["Conjuntos", "conjunto"],
    ["Short", "short"],
    ["Shorts", "short"],
    ["Bermudas", "bermuda"],
    ["Jaquetas", "jaqueta"],
    ["Bolsas", "bolsa"],
    ["Bota", "bota"],
    ["Botas", "bota"],
    ["Tênis", "tenis"],
    ["Sandálias", "sandalia"],
    ["Pijamas", "pijama"],
    ["Biquínis", "biquini"],
    ["Chinelos", "chinelo"],
    ["Camisetas", "camiseta"],
    ["Mochilas", "mochila"],
    ["Perfumes", "perfume"],
    ["Brincos", "brinco"],
    ["Colares", "colar"],
    ["Relógios", "relogio"],
    ["Óculos", "oculos"],
    ["Maquiagem", "maquiagem"],
    ["Toalhas", "toalha"],
    ["Celulares", "celular"],
  ])("%s -> %s", (nome, chave) => {
    expect(chaveSugerida(nome)).toBe(chave);
  });

  it("só palavra inteira conta: Casa não vira Casaco, Bola não vira Bolsa", () => {
    expect(chaveSugerida("Casaco")).toBe("casaco");
    expect(chaveSugerida("Casa")).not.toBe("casaco");
    expect(chaveSugerida("Bola")).not.toBe("bolsa");
  });

  it("com duas palavras que casam, vence a que vem primeiro no nome (o substantivo): Calça jeans -> Calça, Jeans -> Jeans", () => {
    expect(chaveSugerida("Calça jeans")).toBe("calca");
    expect(chaveSugerida("Jeans")).toBe("jeans");
    expect(chaveSugerida("Moletons")).toBe("moletom");
  });

  it("uma frase de duas palavras do catálogo ganha de uma palavra solta", () => {
    expect(chaveSugerida("Calça social")).toBe("calca");
    const social = CATALOGO.find((i) =>
      i.palavras.some((p) => p.includes(" ")),
    );
    expect(social).toBeTruthy();
    const frase = social?.palavras.find((p) => p.includes(" ")) ?? "";
    expect(chaveSugerida(frase)).toBe(social?.chave);
  });

  it("sem nada no catálogo cai no clássico que a vitrine já deduzia; sem nada, nenhuma sugestão", () => {
    expect(chaveSugerida("Moda feminina")).toBe("classico:moda");
    expect(chaveSugerida("Eletrônicos")).toBe("classico:tecnologia");
    expect(chaveSugerida("Novidades")).toBe("estrela"); // palavra do catálogo
    expect(chaveSugerida("Xpto")).toBeNull();
    expect(chaveSugerida("   ")).toBeNull();
    expect(chaveSugerida("???")).toBeNull();
  });

  it("com o catálogo ausente (falhou) ainda sugere o clássico", () => {
    const s = sugerirPeloNome([], "Calçados");
    expect(s).toEqual({ tipo: "classico", chave: "calcados" });
    expect(sugerirPeloNome([], "Blusas")).toBeNull();
  });
});

describe("carregarCatalogo", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    esquecerOCatalogoCarregado();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => esquecerOCatalogoCarregado());

  it("busca o arquivo uma vez, guarda em memória e simultâneos dividem a mesma busca", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => CATALOGO_BRUTO });
    expect(catalogoEmMemoria()).toBeNull();
    const [a, b] = await Promise.all([carregarCatalogo(), carregarCatalogo()]);
    expect(a).toBe(b);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(URL_DO_CATALOGO);
    await carregarCatalogo();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(catalogoEmMemoria()).toBe(a);
  });

  it("falha de rede, HTTP ruim e resposta que não é o catálogo rejeitam e NÃO ficam guardadas", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(carregarCatalogo()).rejects.toThrow();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(carregarCatalogo()).rejects.toThrow(/404/);
    // o catch-all do servidor devolve a página inicial: não é JSON
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });
    await expect(carregarCatalogo()).rejects.toThrow();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await expect(carregarCatalogo()).rejects.toThrow();
    expect(catalogoEmMemoria()).toBeNull();
    // e a tentativa seguinte, com a rede de volta, funciona
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => CATALOGO_BRUTO,
    });
    await expect(carregarCatalogo()).resolves.toHaveLength(CATALOGO.length);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });
});
