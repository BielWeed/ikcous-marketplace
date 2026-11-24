import { LIMITE_DO_NOME_DO_PRODUTO } from "@/lib/limites-do-produto";

// Ao duplicar, o nome ganha " (Cópia <rótulo>)" e o código ganha
// "-COPIA-<uuid>". Dois cuidados para a cópia caber no que o formulário aceita
// e não crescer a cada rodada:
//  - o NOME ORIGINAL é que encolhe até o resultado caber no teto do nome (o
//    sufixo é o que diferencia a cópia e nunca se corta);
//  - o código de uma cópia que já termina em "-COPIA-<uuid>" TROCA esse final
//    pelo novo, em vez de empilhar outro por cima.
const SUFIXO_DO_CODIGO_DA_COPIA =
  /(?:^|-)COPIA-[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i;

function semOSufixoDeCopia(sku: string): string {
  let base = sku;
  // `while`: uma cadeia já empilhada por versão antiga ("-COPIA-A-COPIA-B")
  // é desfeita por inteiro.
  while (SUFIXO_DO_CODIGO_DA_COPIA.test(base)) {
    base = base.replace(SUFIXO_DO_CODIGO_DA_COPIA, "");
  }
  return base;
}

function cortarNome(nome: string, limite: number): string {
  if (nome.length <= limite) return nome;
  let corte = nome.slice(0, limite);
  // O teto do campo conta unidades UTF-16: não deixa metade de um emoji.
  if (/[\uD800-\uDBFF]$/.test(corte)) corte = corte.slice(0, -1);
  return corte.trimEnd();
}

export function nomeECodigoDaCopia({
  nome,
  sku,
  codigo,
}: {
  readonly nome: string;
  readonly sku: string | null | undefined;
  readonly codigo: string;
}): { nome: string; sku: string } {
  const rotulo = codigo.replaceAll("-", "").slice(0, 12);
  const sufixoDoNome = ` (Cópia ${rotulo})`;
  const base = semOSufixoDeCopia(sku ?? "");
  return {
    nome: `${cortarNome(nome, LIMITE_DO_NOME_DO_PRODUTO - sufixoDoNome.length)}${sufixoDoNome}`,
    sku: `${base ? `${base}-` : ""}COPIA-${codigo}`,
  };
}
