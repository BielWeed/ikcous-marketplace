function intervalo(inicio: number, fim: number) {
  return Array.from({ length: fim - inicio + 1 }, (_, i) => inicio + i);
}

export const nomesInvisiveis: ReadonlyArray<readonly [string, string]> = [
  ...[
    ...intervalo(0x200b, 0x200f),
    ...intervalo(0x202a, 0x202e),
    ...intervalo(0x2060, 0x2064),
    0xfeff,
    0x00ad,
    0x180e,
    0x034f,
    0x115f,
    0x1160,
    0x3164,
    0x2800,
    0x00a0,
    ...intervalo(0x2000, 0x200a),
    0x3000,
    ...intervalo(0xfe00, 0xfe0f),
    ...intervalo(0xe0020, 0xe007f),
  ].map(
    (codigo) =>
      [
        `U+${codigo.toString(16).toUpperCase().padStart(4, "0")}`,
        String.fromCodePoint(codigo),
      ] as const,
  ),
  ["mistura", " ​͏ㅤ⠀️\u{E0061}　"],
];

export const nomesVisiveis = [
  ...nomesInvisiveis.map(
    ([rotulo, invisivel]) => [rotulo, `Á${invisivel}7`] as const,
  ),
  ["letra única com invisíveis", "​A⁠"],
  ["dígito único com invisíveis", "͏7\u{E0061}"],
  ["emoji sozinho", "🍰"],
  ["emoji composto com ZWJ", "👩‍🍳"],
] as const;
