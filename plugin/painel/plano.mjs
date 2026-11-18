// Reads .metodo/plano.md, the plan the session hook downloads from the house:
// the stages of the method, their steps and where the app stands. The panel
// of the app is built on it.

// "- A01 [both] Escolher os países -> Países da pesquisa (trava) (feito)"
function parseStepLine(line) {
  const match = /^- ([A-Z]{1,2}\d{2}) \[(agent|both|student)\] (.+)$/.exec(
    line,
  );

  if (!match) {
    return null;
  }

  let rest = match[3];
  const marks = new Set();
  let tail;

  while (
    (tail = / \((trava|condicional|feito|pulado|bloqueado)\)$/.exec(rest))
  ) {
    marks.add(tail[1]);
    rest = rest.slice(0, tail.index);
  }

  const arrow = rest.lastIndexOf(" -> ");

  return {
    code: match[1],
    actor: match[2],
    title: arrow === -1 ? rest : rest.slice(0, arrow),
    deliverable: arrow === -1 ? "" : rest.slice(arrow + 4),
    gate: marks.has("trava"),
    conditional: marks.has("condicional"),
    done: marks.has("feito"),
    skipped: marks.has("pulado"),
    locked: marks.has("bloqueado"),
  };
}

export function parsePlan(markdown) {
  const plan = { app: "", currentStep: null, stages: [] };

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim();
    const header = /^App: (.+?)\. Concluídos: /.exec(line);
    const current = /Passo da vez: ([A-Z]{1,2}\d{2})/.exec(line);
    const stage = /^## (?:([A-Z]{1,2})\. )?(.+)$/.exec(line);

    if (header) {
      plan.app = header[1];
    }

    if (current && header) {
      plan.currentStep = current[1];
    }

    if (stage) {
      plan.stages.push({
        code: stage[1] ?? stage[2].slice(0, 1),
        name: stage[2],
        steps: [],
      });
      continue;
    }

    const step = parseStepLine(line);

    if (step && plan.stages.length > 0) {
      plan.stages.at(-1).steps.push(step);
    }
  }

  return plan;
}

// Where a step stands for this app.
export function stepState(step, currentStep) {
  if (step.done) {
    return "done";
  }

  if (step.skipped) {
    return "skipped";
  }

  if (step.locked) {
    return "locked";
  }

  return step.code === currentStep ? "current" : "ahead";
}

// A stage is done when every step is behind it, current while the app is in
// it, and ahead before the app gets there.
export function stageStatus(stage, currentStep) {
  const pending = stage.steps.filter((step) => !step.done && !step.skipped);

  if (pending.length === 0) {
    return "done";
  }

  if (
    pending.some((step) => step.code === currentStep) ||
    pending.length < stage.steps.length
  ) {
    return "current";
  }

  return pending.some((step) => step.locked) ? "locked" : "ahead";
}
