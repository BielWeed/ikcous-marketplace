// 23/09/2026, prévia do PR #642: com o porteiro já deixando `/logos/` passar,
// os SVGs chegavam como imagem e os PNGs (Jadlog, J&T, Buslog, Melhor
// Envio, SuperFrete) continuavam voltando o app shell — a regra `*.png` do
// `.gitignore` os deixou de fora do repositório em silêncio. Na máquina de
// quem desenvolve o arquivo existe; no build da Vercel, não.
//
// Por isso o teste pergunta ao GIT, não ao disco: um `existsSync` passaria
// aqui com o arquivo solto na pasta e só falharia no CI.
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { LOGO_AGREGADOR, LOGO_TRANSPORTADORA } from "@/lib/marca-do-frete";

const RAIZ = path.resolve(import.meta.dirname, "..", "..");

const versionados = new Set(
  execFileSync("git", ["ls-files", "public/logos"], {
    cwd: RAIZ,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean),
);

const logosUsados = [
  ...Object.values(LOGO_TRANSPORTADORA),
  ...Object.values(LOGO_AGREGADOR),
];

describe("logos do frete — todo arquivo que o código aponta está no repositório", () => {
  it("há logos para conferir", () => {
    expect(logosUsados.length).toBeGreaterThan(0);
  });

  it.each(logosUsados)("%s está versionado no git", (url) => {
    expect(versionados.has(`public${url}`)).toBe(true);
  });
});
