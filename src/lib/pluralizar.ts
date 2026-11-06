/**
 * "1 alteração" / "2 alterações": o número vem junto, e só o 1 usa o singular
 * (0 e os demais ficam no plural, como na fala: "0 alterações").
 */
export const pluralizar = (n: number, singular: string, plural: string) =>
  `${n} ${n === 1 ? singular : plural}`;
