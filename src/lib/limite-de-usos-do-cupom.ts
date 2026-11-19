export function lerLimiteDeUsosDoCupom(
  entrada: string,
): number | "formato" | "teto" {
  const texto = entrada.trim();
  if (texto === "") return 0;
  const [inicio, ...grupos] = texto.split(".");
  if (
    !/^\d+$/.test(inicio) ||
    (grupos.length > 0 &&
      (!/^[1-9]\d{0,2}$/.test(inicio) ||
        grupos.some((grupo) => !/^\d{3}$/.test(grupo))))
  ) {
    return "formato";
  }

  const limite = Number(inicio + grupos.join(""));
  // A coluna do banco é inteira; preserve o teto do formulário.
  return limite > 2_000_000_000 ? "teto" : limite;
}
