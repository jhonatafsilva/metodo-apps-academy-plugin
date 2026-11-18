// Brings the plan of the app from the server of the house: where the app
// really is, step by step. The server is the source of truth for progress,
// since every step is recorded there by complete_step; the folder keeps a
// copy in .metodo/plano.md that the panel of the app reads.
//
// Only the plan comes in. Nothing of the folder goes out.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

// The server answered and said no, such as a space without an active
// subscription: the message is for the person, word for word.
export class Refused extends Error {}

// The API of the house in production. To work on the method locally, set
// METODO_APPS_ACADEMY_URL=http://localhost:3068.
export const productionUrl = "https://metodo-api.appsacademy.com.br";

export function serverUrl(environment = process.env) {
  return environment.METODO_APPS_ACADEMY_URL || productionUrl;
}

// The key the person typed when the plugin was enabled (kept by Claude Code
// in the safe storage of the computer), or, without the plugin dialog, the
// variable of the environment.
export function agentKey(environment = process.env) {
  return (
    environment.CLAUDE_PLUGIN_OPTION_CHAVE ||
    environment.METODO_APPS_ACADEMY_KEY ||
    ""
  );
}

// Calls one tool of the connector, as the agent would.
export async function callTool(name, args, { url, key, timeout = 8000 }) {
  const response = await fetch(`${url}/mcp`, {
    method: "POST",
    signal: AbortSignal.timeout(timeout),
    headers: {
      authorization: `Bearer ${key}`,
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-protocol-version": "2025-11-25",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
  const text = await response.text();
  // The server may answer as plain JSON or as one server-sent event.
  const json = text.trimStart().startsWith("{")
    ? text
    : (/^data: (.+)$/m.exec(text)?.[1] ?? "{}");
  const { result } = JSON.parse(json);

  if (!result) {
    throw new Error(`O servidor da Apps Academy respondeu ${response.status}.`);
  }

  if (result.isError) {
    throw new Refused(String(result.content?.[0]?.text ?? "Recusado."));
  }

  return JSON.parse(result.content[0].text);
}

export function fetchPlan(projectId, connection) {
  return callTool("project_plan", { projectId }, connection);
}

// "12 de 40 liberados pela assinatura", when the subscription of the space
// does not include every stage of the method.
function unlockedNote(progress) {
  return typeof progress.unlocked === "number" &&
    progress.unlocked < progress.total
    ? ` Liberados pela assinatura: ${progress.unlocked} de ${progress.total}.`
    : "";
}

export function renderPlan(plan) {
  const lines = [
    "# Plano do método",
    "",
    `App: ${plan.project.name}. Concluídos: ${plan.progress.completed} de ${plan.progress.total}.${unlockedNote(plan.progress)} Passo da vez: ${plan.currentStepCode ?? "nenhum"}${plan.currentStepLocked ? " (bloqueado)" : ""}.`,
    "",
    plan.legend,
  ];

  for (const group of plan.groups) {
    lines.push(
      "",
      `## ${group.group}`,
      "",
      ...group.steps.map((step) => `- ${step}`),
    );
  }

  return `${lines.join("\n")}\n`;
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function syncFile(appFolder) {
  return join(resolve(appFolder), ".metodo", "sincronia.json");
}

// The last time the plan was checked with the server, and how it went.
export function readSync(appFolder) {
  return readJson(syncFile(appFolder));
}

// Fetches the plan of the app of this folder and saves it when it changed.
// Writing only on change keeps the panel quiet when nothing moved.
export async function syncPlan(appFolder, environment = process.env) {
  const folder = join(resolve(appFolder), ".metodo");
  const project = readJson(join(folder, "projeto.json"));
  const key = agentKey(environment);
  const record = (status) => {
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      syncFile(appFolder),
      JSON.stringify({ em: new Date().toISOString(), ...status }, null, 2),
    );

    return status;
  };

  if (typeof project?.projectId !== "string") {
    return { ok: false, motivo: "sem-projeto" };
  }

  if (!key) {
    return record({ ok: false, motivo: "sem-chave" });
  }

  try {
    const plan = await fetchPlan(project.projectId, {
      url: serverUrl(environment),
      key,
    });
    const planFile = join(folder, "plano.md");
    const text = renderPlan(plan);
    const before = existsSync(planFile) ? readFileSync(planFile, "utf8") : "";

    if (text !== before) {
      writeFileSync(planFile, text);
    }

    return {
      ...record({ ok: true }),
      mudou: text !== before,
      passoDaVez: plan.currentStepCode ?? null,
      bloqueado: Boolean(plan.currentStepLocked),
    };
  } catch (error) {
    return record({
      ok: false,
      motivo: error instanceof Refused ? "recusado" : "erro",
      erro: String(error?.message ?? error),
    });
  }
}

// What changes rarely and only matters to the panel of the app: the text of
// each step written for the person, and the profile of who builds. Fetched
// when a session starts, never after each step.
export async function syncPanelData(appFolder, environment = process.env) {
  const folder = join(resolve(appFolder), ".metodo");
  const project = readJson(join(folder, "projeto.json"));
  const key = agentKey(environment);

  if (typeof project?.projectId !== "string" || !key) {
    return { ok: false };
  }

  const connection = { url: serverUrl(environment), key };
  const [texts, profile] = await Promise.allSettled([
    callTool("step_texts", { projectId: project.projectId }, connection),
    callTool("get_profile", {}, connection),
  ]);

  mkdirSync(folder, { recursive: true });

  if (texts.status === "fulfilled") {
    writeFileSync(
      join(folder, "textos.json"),
      JSON.stringify(texts.value.texts ?? {}, null, 2),
    );
  }

  if (profile.status === "fulfilled") {
    writeFileSync(
      join(folder, "perfil.json"),
      JSON.stringify(profile.value, null, 2),
    );
  }

  return {
    ok: texts.status === "fulfilled" && profile.status === "fulfilled",
  };
}

// The profile, again, right after the agent saved what the person told it.
export async function syncProfile(appFolder, environment = process.env) {
  const folder = join(resolve(appFolder), ".metodo");
  const key = agentKey(environment);

  if (!key) {
    return { ok: false };
  }

  const profile = await callTool(
    "get_profile",
    {},
    { url: serverUrl(environment), key },
  );

  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "perfil.json"), JSON.stringify(profile, null, 2));

  return { ok: true };
}
