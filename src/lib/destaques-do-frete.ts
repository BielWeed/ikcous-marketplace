// DESTAQUES DO FRETE (release 1.5.7 — múltiplos provedores, dois selos).
//
// Com Melhor Envio + SuperFrete + Frenet ligados ao mesmo tempo, a lista de
// frete pode chegar com uma dezena de opções — e a cliente não escolhe bem
// numa lista longa (ela decora a mais cara antes de rolar até a barata).
// O pedido do dono: destacar SÓ duas — a mais barata e a mais rápida de
// TODAS — e esconder o resto atrás de "+ Ver outras opções".
//
// CONTRATO-1.5.7.md §6 + R1-7 (nomes) + R2-4 (a entrega local participa;
// a retirada não):
//   - mais barata: menor preço; empate, menor prazo; empate, o id (ordem
//     estável, nunca depende da ordem de chegada da lista);
//   - mais rápida: menor prazo; empate, menor preço; empate, o id;
//   - a MESMA oferta ganhando os dois vira UM item com os dois selos —
//     nunca dois cartões repetidos (ex.: Loggi mais barata E mais rápida:
//     um cartão com os dois selos, o SEDEX cai em `outras`);
//   - `outras` = o resto, em preço crescente, sem repetir quem já é destaque;
//   - a retirada nunca entra aqui: ela é modalidade da loja, não uma oferta
//     de entrega para competir por "mais barata"/"mais rápida" (ela SEMPRE
//     seria a mais barata, R$ 0, e isso não é o que o selo quer dizer).
import { ehRetiradaNaLoja } from "@/lib/guarda-de-frete";

/** O mínimo que uma opção precisa ter para disputar os destaques. */
export interface OpcaoParaDestaque {
  id: string;
  price: number;
  deliveryDays: number;
}

export interface DestaquesDoFrete<T extends OpcaoParaDestaque> {
  /** A oferta de menor preço entre as elegíveis, ou `null` sem nenhuma. */
  maisBarata: T | null;
  /** A oferta de menor prazo entre as elegíveis, ou `null` sem nenhuma. */
  maisRapida: T | null;
  /** `true` quando a mesma oferta venceu as duas corridas (um cartão só). */
  mesmaOferta: boolean;
  /** O resto das opções elegíveis, em preço crescente, sem repetir destaque. */
  outras: T[];
}

function comparaPrecoDepoisPrazo(a: OpcaoParaDestaque, b: OpcaoParaDestaque) {
  return (
    a.price - b.price ||
    a.deliveryDays - b.deliveryDays ||
    a.id.localeCompare(b.id)
  );
}

function comparaPrazoDepoisPreco(a: OpcaoParaDestaque, b: OpcaoParaDestaque) {
  return (
    a.deliveryDays - b.deliveryDays ||
    a.price - b.price ||
    a.id.localeCompare(b.id)
  );
}

export function destaquesDoFrete<T extends OpcaoParaDestaque>(
  opcoes: readonly T[] | null | undefined,
): DestaquesDoFrete<T> {
  const elegiveis = (opcoes ?? []).filter((o) => !ehRetiradaNaLoja(o.id));

  if (elegiveis.length === 0) {
    return {
      maisBarata: null,
      maisRapida: null,
      mesmaOferta: false,
      outras: [],
    };
  }

  const maisBarata = [...elegiveis].sort(comparaPrecoDepoisPrazo)[0];
  const maisRapida = [...elegiveis].sort(comparaPrazoDepoisPreco)[0];
  const mesmaOferta = maisBarata.id === maisRapida.id;

  const idsDosDestaques = new Set(
    mesmaOferta ? [maisBarata.id] : [maisBarata.id, maisRapida.id],
  );
  const outras = elegiveis
    .filter((o) => !idsDosDestaques.has(o.id))
    .sort(comparaPrecoDepoisPrazo);

  return { maisBarata, maisRapida, mesmaOferta, outras };
}
