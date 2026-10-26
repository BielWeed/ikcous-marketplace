// O convite de avisos (PushNotificationBanner):
//   E1. `bottom-20` (80 px) deixava ~18 px dele sobre a barra de baixo em
//       iPhone com area segura: a distancia agora soma `--safe-area-bottom`;
//   E2. `animate-ping` e `animate-bounce` ignoravam "reduzir movimento":
//       agora so rodam sob `motion-safe:`.
// jsdom nao ve CSS: o teste le o texto-fonte (a classe exata no JSX). O que so
// o navegador prova (a folga real no iPhone) nao e provado aqui.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// eslint-disable-next-line security/detect-non-literal-fs-filename -- le o arquivo-fonte do proprio repositorio (caminho constante), nao entrada de usuario
const fonte = readFileSync(
  resolve(__dirname, "../../src/components/pwa/PushNotificationBanner.tsx"),
  "utf8",
);

describe("PushNotificationBanner: area segura e movimento reduzido", () => {
  it("E1: a distancia do rodape soma a area segura do aparelho", () => {
    expect(fonte).toContain("bottom-[calc(80px+var(--safe-area-bottom,0px))]");
    expect(fonte).not.toMatch(/["\s]bottom-20["\s]/);
  });

  it("E2: ping e bounce so rodam com movimento permitido", () => {
    expect(fonte).toContain("motion-safe:animate-ping");
    expect(fonte).toContain("motion-safe:animate-bounce");
    expect(fonte).not.toMatch(/(^|[\s"])animate-(ping|bounce)/);
  });
});
