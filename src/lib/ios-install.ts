interface NavegadorIOS {
  readonly userAgent: string;
  readonly platform: string;
  readonly maxTouchPoints: number;
}

/** iPadOS pode anunciar MacIntel no Safari em modo desktop. */
export function deveMostrarGuiaIOS(
  navegador: NavegadorIOS,
  standalonePorMedia: boolean,
  standalonePorNavigator: boolean,
): boolean {
  const aparelhoAppleMovel =
    /iPhone|iPad/i.test(navegador.userAgent) ||
    (navegador.platform === "MacIntel" && navegador.maxTouchPoints > 1);
  return aparelhoAppleMovel && !standalonePorMedia && !standalonePorNavigator;
}
