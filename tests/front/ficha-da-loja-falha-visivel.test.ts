// @vitest-environment jsdom
//
// Falha fechada VISÍVEL (menor da revisão Opus, rodada B, 11/09/2026):
// quando a ficha da loja está PRESENTE e é INVÁLIDA, `lerFichaDaLoja()`
// lança `IDENTITY_FICHA_INVALID` — e sem tratamento nenhum, ninguém vê nada:
// o React nunca monta, o loader do silent-guardian fica girando para
// sempre. `buildIdentity.ts` (src/config/buildIdentity.ts) pinta a tela
// ANTES de relançar.
//
// CORREÇÃO (rodada 2, achado 1 do revisor Opus, 11/09/2026): a versão
// anterior deste teste MOCAVA `@/lib/env` (`vi.mock`) e só afirmava que um
// espião foi chamado — isso comprava confiança falsa. Contra o módulo REAL
// (sem mock), a implementação anterior NUNCA pintava nada: `buildIdentity.ts`
// chamava `renderBootFailure` importando `@/lib/env` DINAMICAMENTE de
// dentro do `catch`, mas `env.ts` computa `SUPABASE_URL = lerSupabaseUrl()`
// na PRÓPRIA avaliação do módulo (T1, rodada A, fora do escopo desta
// tarefa) — que volta a chamar `lerFichaDaLoja()` e relança O MESMO
// `IDENTITY_FICHA_INVALID` (o cache do módulo só guarda SUCESSO, nunca
// falha). Em ESM, um módulo cuja avaliação lança nunca entrega seu
// namespace a quem o importa — nem por import estático, nem por import
// DINÂMICO — então `import("@/lib/env")` SEMPRE rejeitava com ficha
// inválida, o `.then(renderBootFailure)` nunca rodava, `#root` ficava
// vazio e o loader do silent-guardian continuava girando: exatamente o
// "loader eterno sem mensagem" que este item existe para eliminar. Medido
// com o módulo real antes desta correção: stderr emitia
// `[fichaDaLoja] Não foi possível pintar a falha de boot.` e `#root.innerHTML`
// ficava `""`.
//
// A correção tira a dependência de `@/lib/env` do caminho de falha:
// `buildIdentity.ts` pinta a tela com uma função PRÓPRIA, sem nenhum
// import de módulo que possa (por desenho, fora do escopo desta tarefa)
// relançar a mesma ficha inválida. Este teste usa o módulo REAL (nenhum
// mock) e afirma o efeito no DOM, como o brief pede literalmente: "`#root`
// contém a mensagem e o erro é relançado".
import { FICHA_DA_LOJA_ID } from "@/config/fichaDaLojaContract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarBuildIdentity } from "./fixtures/build-identity";

function injetarFichaQuebrada() {
  const elemento = document.createElement("script");
  elemento.type = "application/json";
  elemento.id = FICHA_DA_LOJA_ID;
  elemento.textContent = "{ isto nao e json valido";
  document.head.appendChild(elemento);
}

// Mesmos ids que `index.html` usa de verdade (`silent-guardian-loader`,
// `root`) — é o que `renderBootFailure`/nossa pintura procuram.
function montarDomDeBoot() {
  document.body.innerHTML =
    '<div id="silent-guardian-loader"></div><div id="root"></div>';
}

describe("buildIdentity.ts — falha fechada VISÍVEL quando a ficha é inválida (módulo REAL, sem mock)", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    montarDomDeBoot();
  });
  afterEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("ficha quebrada: pinta #root com a mensagem, remove o loader, e RELANÇA o erro", async () => {
    injetarFichaQuebrada();
    vi.resetModules();
    vi.stubGlobal("__STORE_IDENTITY__", criarBuildIdentity("Assado", "assado"));

    await expect(import("@/config/buildIdentity")).rejects.toThrow(
      "IDENTITY_FICHA_INVALID",
    );

    // O loader eterno some — é o sintoma que este item existe para matar.
    expect(document.getElementById("silent-guardian-loader")).toBeNull();
    const root = document.getElementById("root");
    expect(root).not.toBeNull();
    expect(root?.innerHTML).toContain("Loja em manutenção");
  });

  it("ficha ausente (caminho feliz): NÃO pinta nada — loader e #root continuam como estavam", async () => {
    vi.resetModules();
    vi.stubGlobal("__STORE_IDENTITY__", criarBuildIdentity("Assado", "assado"));

    await import("@/config/buildIdentity");

    expect(document.getElementById("silent-guardian-loader")).not.toBeNull();
    expect(document.getElementById("root")?.innerHTML).toBe("");
  });
});
