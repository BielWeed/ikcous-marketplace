// O atributo credentialless do iframe (Chrome 110+) ainda não existe nos
// tipos do React 19. Continua usado no mapa (AboutStoreView e
// AdminAboutStoreView) e no desafio 3DS do cartão (PagamentoComCartao) mesmo
// depois de o app deixar de enviar COEP credentialless (26/09/2026 — decisão
// do dono, travava o Card Payment Brick): sem o COEP do app o atributo já não
// evita bloqueio, mas continua inofensivo (carrega o iframe num contexto sem
// cookies) e trocar isso não fazia parte desta decisão.
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
