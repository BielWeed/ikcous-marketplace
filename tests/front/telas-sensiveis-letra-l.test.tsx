// Onda L · frente "telas-sensiveis" — prova ESTÁTICA (lê o fonte; o jsdom não
// aplica CSS, então a medida de verdade é a do render).
//
// As telas de caminho sensível (login, devoluções, recibo do pedido, "quem pode
// usar o cupom") não têm texto abaixo de 11px (a régua do painel: `text-[6px]`
// … `text-[10.5px]`), fora de comentário. Só a classe de tamanho muda; o que a
// régua ainda conta nesses arquivos é cor literal e `fixed inset-0`, que não é
// texto e fica fora desta onda.
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-unsafe-regex --
   lê arquivos-fonte do próprio repositório (caminhos constantes deste teste, não entrada de usuário); regex constantes, sem backtracking sobre entrada externa */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");

const TELAS_SENSIVEIS = [
  "src/views/admin/AdminLoginView.tsx",
  "src/views/admin/AdminDevolucoesView.tsx",
  "src/components/admin/devolucoes/AcoesDaDevolucao.tsx",
  "src/components/admin/devolucoes/DetalheDaDevolucao.tsx",
  "src/components/admin/devolucoes/SelosDaDevolucao.tsx",
  "src/components/admin/devolucoes/CartaoDaDevolucao.tsx",
  "src/components/admin/orders/OrderReceipt.tsx",
  "src/components/admin/coupons/QuemPodeUsarOCupom.tsx",
] as const;

/** `text-[6px]` … `text-[10.5px]` (qualquer tamanho em px abaixo de 11). */
const TEXTO_PEQUENO = /text-\[(?:\d|10)(?:\.\d+)?px\]/g;

function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("//"))
    .join("\n");
}

function achadosDeTextoPequeno(fonte: string): string[] {
  return semComentarios(fonte).match(TEXTO_PEQUENO) ?? [];
}

describe("telas sensíveis sem texto abaixo de 11px", () => {
  it("o auxiliar acha o texto pequeno e ignora 11px, comentário e cor", () => {
    expect(
      achadosDeTextoPequeno(
        '<i className="text-[6px] text-[9px] text-[10px] text-[10.5px] text-[11px] text-[12px] text-[#09090b]" />',
      ),
    ).toEqual(["text-[6px]", "text-[9px]", "text-[10px]", "text-[10.5px]"]);
    expect(
      achadosDeTextoPequeno(
        "// text-[9px] no comentário não conta\n/* text-[8px] também não */\n",
      ),
    ).toEqual([]);
  });

  it.each(TELAS_SENSIVEIS)("%s não tem text-[<11px]", (caminho) => {
    const fonte = readFileSync(join(RAIZ, caminho), "utf8");
    expect(achadosDeTextoPequeno(fonte)).toEqual([]);
  });
});
