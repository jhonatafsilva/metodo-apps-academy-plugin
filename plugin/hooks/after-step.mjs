// Runs after the agent records a step (complete_step), opens an app
// (open_project) or saves the profile (save_profile). The server of the house
// has just changed, so the folder fetches what changed once and the open
// panel of the app shows it at once. One call per change, never a timer.
import { readFileSync } from "node:fs";

import { syncPlan, syncProfile } from "../painel/conector.mjs";

let folder = process.cwd();
let tool = "";

try {
  // Claude Code sends the event on stdin, with the folder of the session.
  const event = JSON.parse(readFileSync(0, "utf8"));

  if (typeof event.cwd === "string" && event.cwd) {
    folder = event.cwd;
  }

  tool = String(event.tool_name ?? "");
} catch {
  // Without the event, the folder the hook runs in is the folder of the app.
}

try {
  await (tool.endsWith("__save_profile")
    ? syncProfile(folder)
    : syncPlan(folder));
} catch {
  // The step is already recorded on the server; the copy catches up later.
}
