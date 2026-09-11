// A ficha da loja (etapa 2 da escala, 11/09/2026) viaja dentro de um
// `<script type="application/json" id="ikcous-loja">` no HTML que o porteiro
// serve. Este arquivo cobre só a SERIALIZAÇÃO (src/hospedagem/ficha.ts):
// que o texto produzido nunca deixa um `</script>` ou `<!--` crus escaparem
// do data block, e que o resultado continua sendo JSON válido — o lado que
// lê (`JSON.parse`, nunca `eval`) é quem cobra isso.
import { describe, expect, it } from "vitest";

import { FICHA_DA_LOJA_ID } from "@/config/fichaDaLojaContract";
import type { FichaDaLoja } from "@/config/fichaDaLojaContract";
import {
  montarDataBlock,
  serializarFichaParaDataBlock,
} from "@/hospedagem/ficha";

function assetFixture() {
  return {
    path: `v1/${"a".repeat(64)}/marca.png`,
    sha256: "a".repeat(64),
    media_type: "image/png" as const,
    bytes: 100,
  };
}

function urlsFixture() {
  const base =
    "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public/branding";
  return {
    header: `${base}/header.png`,
    loader: `${base}/loader.png`,
    favicon: `${base}/favicon.png`,
    apple_touch: `${base}/apple.png`,
    icon_192: `${base}/icon192.png`,
    icon_512: `${base}/icon512.png`,
    maskable_512: `${base}/maskable.png`,
    og: `${base}/og.png`,
    originals: [] as string[],
  };
}

function fichaFixture(storeName = "Loja A"): FichaDaLoja {
  return {
    schemaVersion: 1,
    host: "loja-a.exemplo",
    identidade: {
      identity: {
        schemaVersion: 1,
        projectRef: "abcdefghijklmnopqrst",
        storeName,
        city: null,
        state: null,
        theme: {
          primary: "#123456",
          secondary: "#654321",
          accent: "#ABCDEF",
        },
        assets: {
          version: 1,
          originals: [],
          header: assetFixture(),
          loader: assetFixture(),
          favicon: assetFixture(),
          apple_touch: assetFixture(),
          icon_192: assetFixture(),
          icon_512: assetFixture(),
          maskable_512: assetFixture(),
          og: assetFixture(),
        },
        urls: urlsFixture(),
      },
      localUrls: urlsFixture(),
      publicUrl: "https://loja-a.exemplo",
      identityRevision: "a".repeat(64),
    },
    conexao: {
      supabaseUrl: "https://abcdefghijklmnopqrst.supabase.co",
      publishableKey: "sb_publishable_de_teste",
    },
  };
}

describe("serializarFichaParaDataBlock — nunca deixa a ficha quebrar o HTML nem o JSON.parse", () => {
  it("produz JSON válido que faz round-trip para a ficha original", () => {
    const ficha = fichaFixture();
    const texto = serializarFichaParaDataBlock(ficha);
    expect(JSON.parse(texto)).toEqual(ficha);
  });

  it("`</script>` no nome da loja não sobrevive cru no texto serializado", () => {
    const nome = "Loja </script><script>alert(1)</script>";
    const ficha = fichaFixture(nome);
    const texto = serializarFichaParaDataBlock(ficha);
    expect(texto).not.toContain("</script>");
    expect(JSON.parse(texto).identidade.identity.storeName).toBe(nome);
  });

  it("`<!--` no nome da loja não sobrevive cru — e o texto continua JSON válido", () => {
    const nome = "Loja <!--comentario-->";
    const ficha = fichaFixture(nome);
    const texto = serializarFichaParaDataBlock(ficha);
    expect(texto).not.toContain("<!--");
    // Divergência medida do contrato (`src/config/fichaDaLojaContract.ts:16`,
    // que descreve `<!--` -> `<\!--`): `\!` não é um escape JSON válido
    // (RFC 8259) e `JSON.parse('"<\\!--"')` LANÇA `SyntaxError: Bad escaped
    // character` (medido com node, ver relatório da tarefa). Aqui a mesma
    // proteção sai como `<!--` (escape unicode do `<`), válida em JSON
    // e que ainda impede o caractere `<` cru de aparecer antes de `!--` no
    // HTML — o parse abaixo prova o round-trip para o valor original.
    expect(JSON.parse(texto).identidade.identity.storeName).toBe(nome);
  });

  it("U+2028 e U+2029 no nome da loja não sobrevivem crus — round-trip pelo JSON.parse", () => {
    const nome = `Loja${String.fromCharCode(0x2028)}Linha${String.fromCharCode(0x2029)}Outra`;
    const ficha = fichaFixture(nome);
    const texto = serializarFichaParaDataBlock(ficha);
    expect(texto).not.toContain(String.fromCharCode(0x2028));
    expect(texto).not.toContain(String.fromCharCode(0x2029));
    expect(texto).toContain("\\u2028");
    expect(texto).toContain("\\u2029");
    expect(JSON.parse(texto).identidade.identity.storeName).toBe(nome);
  });
});

describe("montarDataBlock — a tag completa", () => {
  it("usa o id do contrato e é a única tag `<script>` no texto produzido", () => {
    const ficha = fichaFixture();
    const bloco = montarDataBlock(ficha);
    expect(
      bloco.startsWith(
        `<script type="application/json" id="${FICHA_DA_LOJA_ID}">`,
      ),
    ).toBe(true);
    expect(bloco.endsWith("</script>")).toBe(true);
    const ocorrencias = bloco.match(/<script/g) ?? [];
    expect(ocorrencias.length).toBe(1);
  });

  it("com </script> embutido no nome, o HTML continua sendo UMA só tag <script id=ikcous-loja>", () => {
    // Um `<script>` de ABERTURA cru embutido no valor (sem `/` depois de
    // `<`) não é perigoso: dentro do modo "raw text" de um elemento
    // <script>, o parser HTML só procura a sequência `</script` para
    // terminar o elemento — um `<script>` solto no meio é texto inerte. O
    // que TEM de valer é: só existe UMA sequência `</script>` real (a que
    // fecha o elemento verdadeiro) e só UM atributo `id="ikcous-loja"`.
    const nome = "Loja </script><script>evil()</script>";
    const ficha = fichaFixture(nome);
    const bloco = montarDataBlock(ficha);
    const fechamentosReais = bloco.match(/<\/script>/g) ?? [];
    const ocorrenciasDoId = bloco.split(`id="${FICHA_DA_LOJA_ID}"`).length - 1;
    expect(fechamentosReais.length).toBe(1);
    expect(ocorrenciasDoId).toBe(1);
    const dentroDoScript = bloco.slice(
      bloco.indexOf(">") + 1,
      bloco.lastIndexOf("<"),
    );
    expect(JSON.parse(dentroDoScript).identidade.identity.storeName).toBe(nome);
  });
});
