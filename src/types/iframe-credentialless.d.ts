// O atributo credentialless do iframe (Chrome 110+) ainda não existe nos
// tipos do React 19. Continua usado nos mapas (AboutStoreView,
// AdminAboutStoreView e AddressList) e no desafio 3DS do cartão
// (PagamentoComCartao) mesmo depois de o app deixar de enviar COEP
// credentialless (26/09/2026 — decisão do dono, travava o Card Payment Brick).
// Sem o COEP o atributo já não evita bloqueio; ele só abre o iframe num pote de
// cookies vazio e faz popups de dentro saírem noopener (Chromium 110+). Nos
// mapas isso já era o comportamento em produção; no 3DS não está provado (ver
// o comentário em PagamentoComCartao).
// O import torna este arquivo um MÓDULO: sem ele, o declare module deixa de
// ser augmentation e passa a sombrear os tipos do react inteiros.
import "react";

declare module "react" {
  // A fusão da interface (augmentation) exige o MESMO nome do parâmetro da
  // declaração React — nome diferente quebra o casamento (TS2428/TS2314),
  // por isso o parâmetro fica sem uso na assinatura.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- supressão localizada do parâmetro exigido pela assinatura do augmentation
  interface IframeHTMLAttributes<T> {
    credentialless?: string | undefined;
  }
}
