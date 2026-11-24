// CARTÃO PELO APP — a borda EXATA do cache da config no checkout.
//
// `lerConfigDoCartao` promete "até 1 minuto": a lojista que desliga o cartão no
// painel não espera cada cliente recarregar. O teste `config-do-cartao.test.ts`
// confere 59 s (ainda em cache) e 61 s (vencido), mas nenhum dos dois separa
// `<` de `<=`: trocar o operador deixava o cache valendo 1 ms a mais e nenhum
// teste caía. Aqui o relógio para em 59.999 ms e em 60.000 ms exatos.
//
// A ordem é a que o dinheiro pede: no instante de 60.000 ms o cache JÁ venceu
// (o painel pode ter desligado o cartão e o checkout não pode oferecê-lo).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { banco } = vi.hoisted(() => ({
  banco: {
    leituras: 0,
    credito: true,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            banco.leituras += 1;
            return {
              data: {
                credito: banco.credito,
                debito: false,
                parcelas_max: 3,
              },
              error: null,
            };
          },
        }),
      }),
    }),
    rpc: vi.fn(),
  },
}));

import {
  esquecerConfigDoCartao,
  lerConfigDoCartao,
} from "@/lib/config-do-cartao";

const COMECO = new Date("2026-11-24T12:00:00.000Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(COMECO);
  esquecerConfigDoCartao();
  banco.leituras = 0;
  banco.credito = true;
});

afterEach(() => {
  esquecerConfigDoCartao();
  vi.useRealTimers();
});

describe("lerConfigDoCartao — validade do cache de 1 minuto", () => {
  it("1 ms antes do minuto cheio ainda serve o cache (uma ida ao banco só)", async () => {
    await lerConfigDoCartao();
    vi.setSystemTime(COMECO + 59_999);
    const segunda = await lerConfigDoCartao();
    expect(segunda.ok && segunda.config.credito).toBe(true);
    expect(banco.leituras).toBe(1);
  });

  it("no milissegundo exato do minuto o cache JÁ venceu: lê de novo e enxerga o que o painel mudou", async () => {
    await lerConfigDoCartao();
    banco.credito = false; // a lojista desligou o cartão no painel
    vi.setSystemTime(COMECO + 60_000);
    const depois = await lerConfigDoCartao();
    expect(banco.leituras).toBe(2);
    expect(depois.ok && depois.config.credito).toBe(false);
  });

  it("duas leituras no mesmo instante dividem a mesma ida ao banco (sem rajada)", async () => {
    const [a, b] = await Promise.all([
      lerConfigDoCartao(),
      lerConfigDoCartao(),
    ]);
    expect(banco.leituras).toBe(1);
    expect(a).toBe(b);
  });
});
