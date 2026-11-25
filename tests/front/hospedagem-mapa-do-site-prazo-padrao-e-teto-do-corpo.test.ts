// Caça por mutação (25/11/2026) em `src/hospedagem/mapaDoSite.ts`: dois números
// que `tests/front/mapa-do-site.test.ts` só provava de longe (prazos de 30-60 ms
// passados pela opção, corpo de 600 KB) e que podiam subir 1 sem ninguém ver.
//  - O PRAZO PADRÃO da leitura do catálogo para o robô é de EXATAMENTE 8000 ms.
//  - O TETO do corpo de cada página do PostgREST é de EXATAMENTE 512 KiB
//    (524288 caracteres): um a mais falha, o próprio teto passa.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRAZO_MAPA_MS, buscarIdsDosProdutos } from "@/hospedagem/mapaDoSite";

const conexao = {
  supabaseUrl: "https://projetoaaaaaaaaaaaaa.supabase.co",
  publishableKey: "sb_publishable_a",
};

const TETO_DO_CORPO = 512 * 1024;

/** Lista vazia `[]` com espaços dentro até o corpo ter `tamanho` caracteres. */
const listaVaziaComTamanho = (tamanho: number) =>
  `[${" ".repeat(tamanho - 2)}]`;

describe("buscarIdsDosProdutos — prazo padrão de 8000 ms", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("o prazo padrão exportado vale 8000 ms", () => {
    expect(PRAZO_MAPA_MS).toBe(8_000);
  });

  it("banco que nunca responde: falha com MAPA_PRAZO exatamente aos 8000 ms, nem antes nem depois", async () => {
    const fetchImpl = vi.fn(
      () => new Promise<Response>(() => {}),
    ) as unknown as typeof fetch;
    let resultado: "pendente" | "recusado" = "pendente";
    const leitura = buscarIdsDosProdutos(conexao, { fetchImpl }).catch(
      (erro: Error) => {
        resultado = "recusado";
        return erro;
      },
    );

    await vi.advanceTimersByTimeAsync(7_999);
    expect(resultado).toBe("pendente");

    await vi.advanceTimersByTimeAsync(1);
    const erro = await leitura;
    expect(resultado).toBe("recusado");
    expect((erro as Error).message).toBe("MAPA_PRAZO");
  });
});

describe("buscarIdsDosProdutos — teto de 512 KiB por página", () => {
  const respostaCom = (corpo: string) =>
    (async () =>
      new Response(corpo, {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

  it("corpo com EXATAMENTE 524288 caracteres ainda passa (lista vazia)", async () => {
    const corpo = listaVaziaComTamanho(TETO_DO_CORPO);
    expect(corpo).toHaveLength(524_288);

    await expect(
      buscarIdsDosProdutos(conexao, { fetchImpl: respostaCom(corpo) }),
    ).resolves.toEqual([]);
  });

  it("corpo com UM caractere a mais (524289) falha com MAPA_CORPO", async () => {
    const corpo = listaVaziaComTamanho(TETO_DO_CORPO + 1);
    expect(corpo).toHaveLength(524_289);

    await expect(
      buscarIdsDosProdutos(conexao, { fetchImpl: respostaCom(corpo) }),
    ).rejects.toThrow(/MAPA_CORPO/);
  });
});
