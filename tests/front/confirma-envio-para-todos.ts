// Avisar clientes: o "Enviar agora" do público "Todos" abre a janela do app
// ("Enviar para todos os clientes?") antes de enviar. Os testes que só querem
// provar o ENVIO (texto, destino, cupom, páginas) tocam no botão da janela com
// este auxiliar. Se a janela não abriu (cliente ou segmento específico, ou uma
// trava avisou antes), não faz nada: quem prova que a pergunta abre, e que
// Voltar não envia, é admin-push-todos-os-clientes-pede-confirmacao.test.tsx.
import { act } from "react";

export async function confirmarEnvioSePerguntar(): Promise<void> {
  const janela = document.querySelector<HTMLElement>(
    '[data-testid="confirmar-acao"]',
  );
  if (!janela) return;
  const botao = Array.from(janela.querySelectorAll("button")).find((b) =>
    (b.textContent ?? "").includes("Enviar agora"),
  );
  await act(async () => {
    botao?.click();
  });
}
