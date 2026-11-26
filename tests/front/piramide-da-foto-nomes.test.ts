// Os NOMES da pirâmide de cópias da foto (plano das miniaturas, 26/11/2026).
//
// A loja em projeto Supabase gratuito não tem a transformação de imagem: cada
// card baixava a foto inteira. A foto nova passa a subir com 3 cópias
// reduzidas (240/480/960 px), e a ORIGINAL é gravada por último com um nome
// MARCADO (`<base>-vw.<ext>` = cópias WebP, `-vj` = cópias JPEG). A marca é a
// prova de que as cópias existem; por isso o leitor da marca falha FECHADO:
// qualquer nome que o envio não gera assim vale como foto sem marca (o
// original, como hoje).
import {
  LADOS,
  extensaoMarcavel,
  marcaDe,
  marcaDoNome,
  nomeDaCopia,
  nomeMarcado,
  nomesDasCopias,
  variantesDe,
} from "@/lib/piramide-da-foto-nomes";
import { describe, expect, it } from "vitest";

const LOJA = "https://novalojagratisaaaaaa.supabase.co";
const PRODUTOS = `${LOJA}/storage/v1/object/public/products/`;
const BANNERS = `${LOJA}/storage/v1/object/public/banners/`;
const UUID = "3f2b8c1e-9a4d-4e7b-8c21-5d6f7a8b9c0d";
const UUID2 = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const BANNER = "1791565996435-7tdkqgfb019";

describe("LADOS", () => {
  it("são 240, 480 e 960, do menor para o maior", () => {
    expect([...LADOS]).toEqual([240, 480, 960]);
  });
});

describe("nomeMarcado e nomeDaCopia", () => {
  it("a original marcada usa hífen e a letra do formato das cópias", () => {
    expect(nomeMarcado(UUID, "w", "jpg")).toBe(`${UUID}-vw.jpg`);
    expect(nomeMarcado(BANNER, "j", "png")).toBe(`${BANNER}-vj.png`);
  });

  it("a cópia leva o lado e a extensão do formato (webp ou jpg)", () => {
    expect(nomeDaCopia(UUID, 240, "w")).toBe(`${UUID}-240.webp`);
    expect(nomeDaCopia(UUID, 960, "j")).toBe(`${UUID}-960.jpg`);
  });

  it("nunca usa til (o nome entra em URL e em caminho de storage)", () => {
    for (const lado of LADOS) {
      expect(nomeDaCopia(UUID, lado, "w")).not.toContain("~");
    }
    expect(nomeMarcado(UUID, "w", "jpg")).not.toContain("~");
  });
});

describe("marcaDoNome", () => {
  it.each([
    [`${UUID}-vw.jpg`, "w"],
    [`${UUID}-vj.JPG`, "j"],
    [`${UUID}-vw.webp`, "w"],
    [`${BANNER}-vw.png`, "w"],
    [`${UUID}_copia_${UUID2}-vw.jpeg`, "w"],
    [`${UUID}_copia_${UUID2}_copia_${UUID}-vj.png`, "j"],
  ])("%s tem marca %s", (nome, marca) => {
    expect(marcaDoNome(nome)?.marca).toBe(marca);
  });

  it("devolve a base e a extensão de volta, intactas", () => {
    expect(marcaDoNome(`${UUID}-vw.JPG`)).toEqual({
      base: UUID,
      marca: "w",
      ext: "JPG",
    });
  });

  it.each([
    ["foto sem marca (o nome de hoje)", `${UUID}.jpg`],
    ["sonda do porteiro", "x.webp"],
    ["banner sem marca", `${BANNER}.webp`],
    [
      "cópia de duplicação antiga (_copia_ no lugar da extensão)",
      `${UUID}_copia_${UUID2}.jpg`,
    ],
    [
      "cópia antiga de foto marcada (a marca ficou no meio)",
      `${UUID}-vw_copia_${UUID2}.jpg`,
    ],
    ["backup de produto apagado", `backup/${UUID}-vw.jpg`],
    ["backup com carimbo de hora", `${UUID}-vw_1791565996435.jpg`],
    ["subpasta", `pasta/${UUID}-vw.jpg`],
    ["a própria cópia", `${UUID}-240.webp`],
    ["marca desconhecida", `${UUID}-vx.jpg`],
    ["til no lugar do hífen", `${UUID}~vw.jpg`],
    ["base que não é uuid nem banner", "minha-foto-vw.jpg"],
    ["uuid em maiúsculas", `${UUID.toUpperCase()}-vw.jpg`],
    ["sem extensão", `${UUID}-vw`],
    ["extensão longa demais", `${UUID}-vw.jpegxl`],
    ["vazio", ""],
  ])("%s: sem marca", (_caso, nome) => {
    expect(marcaDoNome(nome)).toBeNull();
  });
});

describe("nomesDasCopias", () => {
  it("as 3 cópias, na ordem dos lados, no formato da marca", () => {
    expect(nomesDasCopias(`${UUID}-vw.jpg`)).toEqual([
      `${UUID}-240.webp`,
      `${UUID}-480.webp`,
      `${UUID}-960.webp`,
    ]);
    expect(nomesDasCopias(`${BANNER}-vj.png`)).toEqual([
      `${BANNER}-240.jpg`,
      `${BANNER}-480.jpg`,
      `${BANNER}-960.jpg`,
    ]);
  });

  it("nome sem marca não tem cópias", () => {
    expect(nomesDasCopias(`${UUID}.jpg`)).toBeNull();
  });
});

describe("extensaoMarcavel", () => {
  it.each(["jpg", "JPG", "jpeg", "png", "webp", "avif"])("%s serve", (ext) => {
    expect(extensaoMarcavel(ext)).toBe(true);
  });

  it.each(["", "j", "IMG_1234", "jpegxl", "a.b", "jp-g"])(
    "%j não serve (o leitor da marca não a reconheceria)",
    (ext) => {
      expect(extensaoMarcavel(ext)).toBe(false);
    },
  );
});

describe("marcaDe e variantesDe — a URL pública", () => {
  it("foto de produto marcada: as 3 cópias moram ao lado, no mesmo bucket", () => {
    const url = `${PRODUTOS}${UUID}-vw.jpg`;
    expect(marcaDe(url)).toBe("w");
    expect(variantesDe(url)).toEqual([
      `${PRODUTOS}${UUID}-240.webp`,
      `${PRODUTOS}${UUID}-480.webp`,
      `${PRODUTOS}${UUID}-960.webp`,
    ]);
  });

  it("banner marcado com cópias JPEG", () => {
    const url = `${BANNERS}${BANNER}-vj.png`;
    expect(marcaDe(url)).toBe("j");
    expect(variantesDe(url)?.[0]).toBe(`${BANNERS}${BANNER}-240.jpg`);
  });

  it.each([
    ["sem marca", `${PRODUTOS}${UUID}.jpg`],
    ["sonda do porteiro (x.webp)", `${BANNERS}x.webp`],
    ["com consulta", `${PRODUTOS}${UUID}-vw.jpg?v=2`],
    ["com consulta vazia", `${PRODUTOS}${UUID}-vw.jpg?`],
    ["com fragmento", `${PRODUTOS}${UUID}-vw.jpg#x`],
    ["com fragmento vazio", `${PRODUTOS}${UUID}-vw.jpg#`],
    ["backup", `${PRODUTOS}backup/${UUID}-vw.jpg`],
    ["cópia antiga", `${PRODUTOS}${UUID}_copia_${UUID2}.jpg`],
    [
      "outro host",
      `https://cdn.exemplo.com/storage/v1/object/public/products/${UUID}-vw.jpg`,
    ],
    [
      "host que só começa igual",
      `https://loja.supabase.co.exemplo.com/storage/v1/object/public/products/${UUID}-vw.jpg`,
    ],
    [
      "http",
      `http://loja.supabase.co/storage/v1/object/public/products/${UUID}-vw.jpg`,
    ],
    [
      "com porta",
      `https://loja.supabase.co:8443/storage/v1/object/public/products/${UUID}-vw.jpg`,
    ],
    [
      "outro bucket",
      `${LOJA}/storage/v1/object/public/devolucoes/${UUID}-vw.jpg`,
    ],
    [
      "endereço transformado",
      `${LOJA}/storage/v1/render/image/public/products/${UUID}-vw.jpg`,
    ],
    [
      "endereço assinado",
      `${LOJA}/storage/v1/object/sign/products/${UUID}-vw.jpg`,
    ],
    [
      "caminho com ..",
      `${LOJA}/storage/v1/object/public/x/../products/${UUID}-vw.jpg`,
    ],
    ["nome codificado", `${PRODUTOS}${UUID}%2Dvw.jpg`],
    ["data:", "data:image/png;base64,AAAA"],
    ["vazio", ""],
  ])("%s: sem marca e sem cópias (comportamento de hoje)", (_caso, url) => {
    expect(marcaDe(url)).toBeNull();
    expect(variantesDe(url)).toBeNull();
  });

  it("nulo e indefinido não quebram", () => {
    expect(marcaDe(null)).toBeNull();
    expect(variantesDe(undefined)).toBeNull();
  });
});
