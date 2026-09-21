// O atributo credentialless do iframe (Chrome 110+) ainda não existe nos
// tipos do React 19. Ele é a peça que permite o embed do Google Maps sob o
// COEP credentialless do app — ver AboutStoreView e AdminAboutStoreView.
// O import torna este arquivo um MÓDULO: sem ele, o declare module deixa de
// ser augmentation e passa a sombrear os tipos do react inteiros.
import "react";

declare module "react" {
  interface IframeHTMLAttributes<T> {
    credentialless?: string | undefined;
  }
}
