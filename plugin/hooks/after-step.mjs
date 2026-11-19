// Runs after the agent records a step (complete_step), opens an app
// (open_project), names it (rename_project) or saves the profile
// (save_profile). The server of the house has just changed, so the folder
// fetches what changed once and the open panel of the app shows it at once.
// One call per change, never a timer.
//
// Opening an app also starts the panel and opens it in the browser: the
// person sees the app being built from the first step.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  openedProject,
  rememberProject,
  syncPanelData,
  syncPlan,
  syncProfile,
} from "../painel/conector.mjs";
import { startInBackground, writeLauncher } from "../painel/servidor.mjs";

const panelServer = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "painel",
  "servidor.mjs",
);

let folder = process.cwd();
let tool = "";
let response;

try {
  // Claude Code sends the event on stdin, with the folder of the session.
  const event = JSON.parse(readFileSync(0, "utf8"));

  if (typeof event.cwd === "string" && event.cwd) {
    folder = event.cwd;
  }

  tool = String(event.tool_name ?? "");
  response = event.tool_response;
} catch {
  // Without the event, the folder the hook runs in is the folder of the app.
}

// What the agent reads after the tool, such as where the panel opened.
function tell(text) {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: text,
      },
    }),
  );
}

async function openApp() {
  const project = openedProject(response);

  if (!project) {
    return;
  }

  rememberProject(folder, project);
  await Promise.all([
    syncPlan(folder),
    syncPanelData(folder).catch(() => ({ ok: false })),
  ]);
  writeLauncher(folder, panelServer);

  const panel = await startInBackground(folder, panelServer, {
    unlessSeen: true,
  });

  if (panel.url) {
    tell(
      `O plugin gravou .metodo/projeto.json e abriu o painel do app no navegador da pessoa, em ${panel.url}. Diga a ela que é ali que ela vai ver o app sendo construído, passo a passo.`,
    );
  }
}

try {
  if (tool.endsWith("__open_project")) {
    await openApp();
  } else if (tool.endsWith("__save_profile")) {
    await syncProfile(folder);
  } else {
    await syncPlan(folder);
  }
} catch {
  // The step is already recorded on the server; the copy catches up later.
}
