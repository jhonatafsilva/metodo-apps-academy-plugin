// Runs when a session starts. In a folder that already follows the method, it
// reminds the agent of the project and refreshes the plan file straight from
// the server, so the plan never costs tokens to copy.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { syncPanelData, syncPlan } from "../painel/conector.mjs";
import { startInBackground } from "../painel/servidor.mjs";

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

  if (sync.ok) {
    planNote = ` O plano inteiro, com o progresso, está atualizado em .metodo/plano.md (passo da vez: ${sync.passoDaVez ?? "nenhum"}).`;

    // The queue stops at a stage the subscription does not include.
    if (sync.bloqueado) {
      planNote +=
        " O passo da vez é de uma etapa que a assinatura deste espaço não libera: não faça esse passo nem os seguintes, e diga à pessoa que fale com a equipe da Apps Academy para liberar.";
    }
  }

  // The panel of the app runs on this computer. The launcher in .metodo/
  // points to the plugin as it is installed now, so the person can also
  // start the panel without the agent: "node .metodo/painel.mjs".
  let panelNote = "";

  try {
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "painel.mjs"),
      [
        "// Liga o painel deste app. Gerado pelo plugin do Método Apps Academy a cada sessão.",
        "//   node .metodo/painel.mjs            liga e fica rodando",
        "//   node .metodo/painel.mjs --abrir    liga e abre o navegador",
        "//   node .metodo/painel.mjs parar      desliga",
        'import { dirname } from "node:path";',
        'import { fileURLToPath } from "node:url";',
        "",
        `import { runCommand } from ${JSON.stringify(pathToFileURL(panelServer).href)};`,
        "",
        "const appFolder = dirname(dirname(fileURLToPath(import.meta.url)));",
        "",
        `await runCommand(appFolder, process.argv.slice(2), ${JSON.stringify(panelServer)});`,
        "",
      ].join("\n"),
    );

    const panel = await startInBackground(process.cwd(), panelServer);

    if (panel.url) {
      panelNote = ` O painel do app está ligado em ${panel.url}: é onde a pessoa vê o app sendo construído.`;
    }
  } catch {
    // The panel is a convenience: it never stops the session.
  }

  console.log(
    `Esta pasta é o app "${String(state.name ?? "")}", construído pelo Método Apps Academy.${planNote}${panelNote} ` +
      "Antes de qualquer trabalho no app, use a skill app (comando /app) para pegar os passos da vez e seguir a ficha de cada um.",
  );
}
