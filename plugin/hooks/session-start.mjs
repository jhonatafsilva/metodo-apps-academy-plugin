// Runs when a session starts. In a folder that already follows the method, it
// reminds the agent of the project and refreshes the plan file straight from
// the server, so the plan never costs tokens to copy.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { syncPanelData, syncPlan } from "../painel/conector.mjs";
import { startInBackground, writeLauncher } from "../painel/servidor.mjs";

const panelServer = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "painel",
  "servidor.mjs",
);

const folder = join(process.cwd(), ".metodo");
const stateFile = join(folder, "projeto.json");

if (existsSync(stateFile)) {
  let state = {};

  try {
    state = JSON.parse(readFileSync(stateFile, "utf8"));
  } catch {
    // A broken state file is reported by the skill, not here.
  }

  let planNote = "";
  // The server says where the app really is; the folder keeps a copy.
  const [sync] = await Promise.all([
    syncPlan(process.cwd()),
    syncPanelData(process.cwd()).catch(() => ({ ok: false })),
  ]);

  // The server said no, as for a key bound to another computer or a space
  // without subscription: the agent passes the words on and stops.
  if (sync.motivo === "recusado") {
    planNote = ` O método recusou o acesso: "${sync.erro}". Antes de qualquer outra coisa, repita essa mensagem à pessoa e não siga os passos.`;
  }

  if (sync.ok) {
    planNote = ` O plano inteiro, com o progresso, está atualizado em .metodo/plano.md (passo da vez: ${sync.passoDaVez ?? "nenhum"}).`;

    // The queue stops at a stage the subscription does not include.
    if (sync.bloqueado) {
      planNote +=
        " O passo da vez é de uma etapa que a assinatura deste espaço não libera: não faça esse passo nem os seguintes, e diga à pessoa que fale com a equipe da Apps Academy para liberar.";
    }
  }

  // The panel of the app runs on this computer. It opens in the browser
  // when no tab shows it yet, so the person follows the app from the start.
  let panelNote = "";

  try {
    writeLauncher(process.cwd(), panelServer);

    const panel = await startInBackground(process.cwd(), panelServer, {
      unlessSeen: true,
    });

    if (panel.url) {
      panelNote = panel.aberto
        ? ` O painel do app abriu no navegador da pessoa, em ${panel.url}: é onde ela vê o app sendo construído.`
        : ` O painel do app está ligado em ${panel.url} e já aberto no navegador: é onde a pessoa vê o app sendo construído.`;
    }
  } catch {
    // The panel is a convenience: it never stops the session.
  }

  console.log(
    `Esta pasta é o app "${String(state.name ?? "")}", construído pelo Método Apps Academy.${planNote}${panelNote} ` +
      "Antes de qualquer trabalho no app, use a skill app do plugin metodo-apps-academy para pegar os passos da vez e seguir a ficha de cada um.",
  );
}
