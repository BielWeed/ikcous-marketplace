// `normalizarHost` é a forma ÚNICA de host que `atenderPorteiro` usa como
// chave de cache e em `decidirConcordancia` (rodada B, brief T3b item 3).
// `url.hostname` já entrega minúsculo e sem porta (medido, ver comentário em
// `porteiro.ts`) — o que esta função acrescenta é remover o ponto final de
// FQDN, que `URL` preserva.
import { describe, expect, it } from "vitest";

import { normalizarHost } from "@/hospedagem/porteiro";

describe("normalizarHost — minúsculo, sem porta, sem ponto final", () => {
  it("os três casos do brief produzem o MESMO valor", () => {
    const comMaiusculaEPorta = normalizarHost(
      new URL("https://LOJA-A.EXEMPLO:443/"),
    );
    const comPontoFinal = normalizarHost(new URL("https://loja-a.exemplo./"));
    const jaNormalizado = normalizarHost(new URL("https://loja-a.exemplo/"));

    expect(comMaiusculaEPorta).toBe("loja-a.exemplo");
    expect(comPontoFinal).toBe("loja-a.exemplo");
    expect(jaNormalizado).toBe("loja-a.exemplo");
  });

  it("porta não padrão (http, porta explícita) também some — usada pela T6 em localhost", () => {
    expect(normalizarHost(new URL("http://loja-a.localhost:5555/"))).toBe(
      "loja-a.localhost",
    );
  });

  it("múltiplos pontos finais (raro, mas válido em DNS) também somem", () => {
    expect(normalizarHost(new URL("https://loja-a.exemplo../"))).toBe(
      "loja-a.exemplo",
    );
  });
});
