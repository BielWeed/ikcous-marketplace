// Quem pode TROCAR as chaves de pagamento (Mercado Pago) e o e-mail da loja:
// só o dono da loja (24/11/2026). Quem barra de verdade é o servidor
// (`credenciais-mercado-pago` e `credenciais-email` respondem 403 a um
// administrador nomeado); aqui é só conforto: os campos e botões de TROCAR ficam
// travados, com uma frase simples, em vez de deixar a pessoa digitar e levar um
// erro no fim.
//
// Regra (a mesma do servidor, para a tela não prometer o que ele recusa):
//   - é o dono                                  -> liberado
//   - a loja não tem dono cadastrado (tabela    -> liberado (como antes; o furo só
//     lida e vazia)                                fecha depois de cadastrar o dono)
//   - há dono e não sou eu                      -> TRAVADO, "Só o dono da loja…"
//   - ainda lendo                               -> TRAVADO, sem frase: não destrava
//                                                  por engano nem acusa o dono
//   - não consegui ler (erro, rede, tabela      -> TRAVADO, frase NEUTRA (não diz
//     ausente)                                     "só o dono"; pede recarregar)
// "Não consegui ler" nunca vira "sem dono": é o que `leituraFalhou` separa.
import { useDonoDaLoja } from "@/hooks/useDonoDaLoja";

export const AVISO_SO_O_DONO_TROCA_AS_CHAVES =
  "Só o dono da loja troca estas chaves.";
export const AVISO_SO_O_DONO_TROCA_O_EMAIL =
  "Só o dono da loja troca o e-mail da loja.";
export const AVISO_DONO_NAO_CONFERIDO =
  "Não consegui confirmar agora quem é o dono da loja. Recarregue a página para tentar de novo.";

export interface PodeTrocarCredenciais {
  /** Os campos e botões que TROCAM a credencial ficam desabilitados. */
  readonly travado: boolean;
  /** A frase a mostrar junto, ou `null` (liberado, ou ainda lendo). */
  readonly aviso: string | null;
}

/** @param avisoDeNaoDono a frase quando há dono e não sou eu (muda por seção). */
export function usePodeTrocarCredenciais(
  avisoDeNaoDono: string,
): PodeTrocarCredenciais {
  const { souODono, donoId, carregando, leituraFalhou } = useDonoDaLoja();
  if (carregando) return { travado: true, aviso: null };
  if (leituraFalhou) return { travado: true, aviso: AVISO_DONO_NAO_CONFERIDO };
  if (souODono || donoId === null) return { travado: false, aviso: null };
  return { travado: true, aviso: avisoDeNaoDono };
}
