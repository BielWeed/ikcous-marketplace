// @ts-nocheck
/**
 * A LISTA DE RESERVA ACOMPANHA O CADASTRO (achado N6 da caça "frota com 300
 * lojas", 26/11/2026).
 *
 * O CI (.github/workflows/frota-conferir.yml) roda scripts/frota/conferir-frota.mjs
 * SEM --vercel, e aí o inventário é só politica.json → enderecosDeReserva
 * (conferir-frota.mjs, `inventariar`, ramo "reserva"); estado-da-loja.mjs lê a
 * release em produção dos MESMOS endereços (`lerReleaseEmProducao`). A lista era
 * escrita à mão e não tinha elo com o cadastro: uma loja assinante nova entrava em
 * canais-de-backend.json, recebia a release, e o CI continuava conferindo só as
 * antigas — sem ninguém notar.
 *
 * O elo: cada canal de canais-de-backend.json declara o seu `enderecoDeReserva`
 * (o alias .vercel.app da loja no projeto), e este teste reprova se as duas listas
 * divergirem nos dois sentidos — canal sem endereço, endereço do canal fora da
 * reserva, ou endereço na reserva que nenhum canal reclama (loja que saiu).
 * Nada aqui muda o que a publicação faz: só o teste lê o campo novo.
 */
import { fromFileUrl, join } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const RAIZ = fromFileUrl(new URL("..", import.meta.url));
const lerJson = (rel: string) =>
  JSON.parse(Deno.readTextFileSync(join(RAIZ, rel)));
const POLITICA = lerJson("scripts/frota/politica.json");
const CANAIS = lerJson("scripts/frota/canais-de-backend.json");

// O RE_DOMINIO de conferir-frota.mjs (sem esquema, sem barra, minúsculo,
// começa e termina em letra ou número), mais: pelo menos um ponto, nunca "..".
const dominioValido = (d) =>
  typeof d === "string" &&
  /^[a-z0-9.-]+$/.test(d) &&
  /^[a-z0-9]/.test(d) &&
  /[a-z0-9]$/.test(d) &&
  d.includes(".") &&
  !d.includes("..");

/** Cada divergência entre o cadastro (canais) e a reserva (política), em texto. */
function divergenciasDaReserva(politica, canais) {
  const problemas: string[] = [];
  const reserva = politica.enderecosDeReserva ?? [];
  const reclamados = new Map<string, string>();
  for (const [ref, canal] of Object.entries(canais.canais ?? {})) {
    const d = canal?.enderecoDeReserva;
    if (!dominioValido(d)) {
      problemas.push(
        `canal ${ref} (${canal?.nome}) sem enderecoDeReserva válido: ${JSON.stringify(d)}`,
      );
      continue;
    }
    if (reclamados.has(d))
      problemas.push(
        `${d} declarado por dois canais: ${reclamados.get(d)} e ${ref}`,
      );
    reclamados.set(d, ref);
    if (!reserva.includes(d))
      problemas.push(
        `canal ${ref} (${canal.nome}): ${d} fora de politica.json enderecosDeReserva — o CI não confere esta loja`,
      );
  }
  for (const d of reserva)
    if (!reclamados.has(d))
      problemas.push(
        `politica.json enderecosDeReserva tem ${d}, que nenhum canal de canais-de-backend.json declara`,
      );
  if (new Set(reserva).size !== reserva.length)
    problemas.push("politica.json enderecosDeReserva tem endereço repetido");
  return problemas;
}

const CANAL = (nome: string, enderecoDeReserva?: string) => ({
  nome,
  migrations: nome,
  functions: nome,
  ...(enderecoDeReserva === undefined ? {} : { enderecoDeReserva }),
});

Deno.test("reserva × cadastro: o cadastro real e a política concordam (todo canal tem o seu endereço na reserva, e só eles)", () => {
  assert(Object.keys(CANAIS.canais).length >= 2);
  assertEquals(divergenciasDaReserva(POLITICA, CANAIS), []);
});

Deno.test("reserva × cadastro: a IKCOUS e a Savy continuam na reserva, cada uma pelo seu ref", () => {
  assertEquals(
    CANAIS.canais.cafkrminfnokvgjqtkle.enderecoDeReserva,
    "ickous-marketplace.vercel.app",
  );
  assertEquals(
    CANAIS.canais.gnjsrucsmjkajijrakzr.enderecoDeReserva,
    "savycollection.vercel.app",
  );
});

Deno.test("reserva × cadastro: loja assinante nova sem endereço, ou com endereço fora da reserva, reprova", () => {
  const politica = { enderecosDeReserva: ["a.vercel.app"] };
  assertEquals(
    divergenciasDaReserva(politica, {
      canais: { aaaaaaaaaaaaaaaaaaaa: CANAL("A", "a.vercel.app") },
    }),
    [],
  );
  const semEndereco = divergenciasDaReserva(politica, {
    canais: {
      aaaaaaaaaaaaaaaaaaaa: CANAL("A", "a.vercel.app"),
      bbbbbbbbbbbbbbbbbbbb: CANAL("B"),
    },
  });
  assertEquals(semEndereco.length, 1);
  assert(semEndereco[0].includes("bbbbbbbbbbbbbbbbbbbb"));
  const foraDaReserva = divergenciasDaReserva(politica, {
    canais: {
      aaaaaaaaaaaaaaaaaaaa: CANAL("A", "a.vercel.app"),
      bbbbbbbbbbbbbbbbbbbb: CANAL("B", "b.vercel.app"),
    },
  });
  assertEquals(foraDaReserva.length, 1);
  assert(foraDaReserva[0].includes("b.vercel.app"));
});

Deno.test("reserva × cadastro: endereço que ninguém reclama, repetido, ou fora do formato reprova", () => {
  const canais = {
    canais: { aaaaaaaaaaaaaaaaaaaa: CANAL("A", "a.vercel.app") },
  };
  assertEquals(
    divergenciasDaReserva(
      { enderecosDeReserva: ["a.vercel.app", "velha.vercel.app"] },
      canais,
    ).length,
    1,
  );
  assertEquals(
    divergenciasDaReserva(
      { enderecosDeReserva: ["a.vercel.app", "a.vercel.app"] },
      canais,
    ).length,
    1,
  );
  assertEquals(
    divergenciasDaReserva(
      { enderecosDeReserva: ["a.vercel.app"] },
      {
        canais: {
          aaaaaaaaaaaaaaaaaaaa: CANAL("A", "a.vercel.app"),
          bbbbbbbbbbbbbbbbbbbb: CANAL("B", "a.vercel.app"),
        },
      },
    ).length,
    1,
  );
  assertEquals(
    divergenciasDaReserva(
      { enderecosDeReserva: ["a.vercel.app"] },
      { canais: { aaaaaaaaaaaaaaaaaaaa: CANAL("A", "https://a.vercel.app") } },
    ).length,
    2,
  );
});
