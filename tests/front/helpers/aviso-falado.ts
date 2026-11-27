// O texto que o leitor de tela fala sozinho quando o erro do pagamento troca a
// tela. Lote 486: um canal só — o erro que recebe o foco perdido é lido pelo
// foco e perde o `role="alert"` (alerta + foco no mesmo texto fazia o
// VoiceOver/NVDA ler duas vezes); sem o foco, quem fala é o alerta.
export function avisoFalado(raiz: ParentNode): string | null | undefined {
  const alerta = raiz.querySelector('[role="alert"]');
  if (alerta) return alerta.textContent;
  const ativo = document.activeElement;
  if (ativo && ativo !== document.body && raiz.contains(ativo))
    return ativo.textContent;
  return undefined;
}
