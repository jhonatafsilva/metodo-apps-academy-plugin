// The panel of the app: a small web server that runs on the person's computer
// and shows, as the app is built, what each step of the method produced. It
// only reads the folder of the app, answers only this computer and never
// sends anything out. Plain Node, no dependencies: it ships with the plugin.
//
//   node .metodo/painel.mjs            start and keep running
//   node .metodo/painel.mjs --fundo    start in the background and return
//   node .metodo/painel.mjs --abrir    start and open the browser
//   node .metodo/painel.mjs parar      stop the panel of this folder
import { spawn } from "node:child_process";
import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  watch,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { clearInterval, setInterval } from "node:timers";
import { fileURLToPath } from "node:url";

import { readSync, syncPlan } from "./conector.mjs";
import { parsePlan, stageStatus, stepState } from "./plano.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const appBundle = join(here, "app");
const firstPort = 4747;
const lastPort = 4766;
// Without anyone looking for this long, the panel stops by itself.
const idleLimit = 4 * 60 * 60 * 1000;
const stepCode = /^[A-Z]{1,2}\d{2}$/;

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".pdf": "application/pdf",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

// The page of the panel loads only from itself. A prototype runs in a frame,
// from a server on this computer.
const panelPolicy = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self'",
  "font-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "frame-src 'self' http://localhost:* http://127.0.0.1:*",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

// ---------------------------------------------------------------- folder

function appPaths(appFolder) {
  const root = resolve(appFolder);

  return {
    root,
    method: join(root, "metodo"),
    pages: join(root, "metodo", "workbook", "passos"),
    plan: join(root, ".metodo", "plano.md"),
    texts: join(root, ".metodo", "textos.json"),
    profile: join(root, ".metodo", "perfil.json"),
    project: join(root, ".metodo", "projeto.json"),
    state: join(root, ".metodo", "painel.json"),
  };
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// A file inside metodo/, never outside it, links included.
export function insideMethod(methodFolder, path) {
  if (typeof path !== "string" || path.length === 0 || path.includes("\0")) {
    return null;
  }

  const full = resolve(methodFolder, path);

  if (!full.startsWith(methodFolder + sep) || !existsSync(full)) {
    return null;
  }

  const real = realpathSync(full);

  if (!real.startsWith(realpathSync(methodFolder) + sep)) {
    return null;
  }

  return statSync(real).isFile() ? real : null;
}

function readPage(paths, code) {
  const file = join(paths.pages, `${code}.json`);
  const page = readJson(file);

  if (!page || typeof page !== "object") {
    return null;
  }

  return {
    ...page,
    passo: code,
    atualizado: statSync(file).mtime.toISOString(),
    documentos: (Array.isArray(page.documentos) ? page.documentos : [])
      .filter((path) => typeof path === "string" && path.endsWith(".md"))
      .map((path) => {
        const file = insideMethod(paths.method, path);

        return {
          caminho: path,
          existe: Boolean(file),
          tamanho: file ? statSync(file).size : 0,
        };
      }),
  };
}

function pageSummaries(paths) {
  const pages = new Map();

  if (!existsSync(paths.pages)) {
    return pages;
  }

  for (const name of readdirSync(paths.pages)) {
    const code = name.replace(/\.json$/, "");

    if (!name.endsWith(".json") || !stepCode.test(code)) {
      continue;
    }

    const page = readPage(paths, code);

    if (page) {
      pages.set(code, {
        titulo: String(page.titulo ?? ""),
        resumo: String(page.resumo ?? ""),
        data: String(page.data ?? ""),
        atualizado: page.atualizado,
        blocos: Array.isArray(page.blocos) ? page.blocos.length : 0,
      });
    }
  }

  return pages;
}

// What the panel shows at a glance: the stages, where each step stands and
// which steps already have a page. The pages themselves load one by one.
export function readState(appFolder) {
  const paths = appPaths(appFolder);
  const project = readJson(paths.project) ?? {};

  // When the plan was last checked with the server of the house.
  const sincronia = readSync(paths.root);

  if (!existsSync(paths.plan)) {
    return {
      app: String(project.name ?? basename(paths.root)),
      pronto: false,
      sincronia,
      passoDaVez: null,
      progresso: { feitos: 0, total: 0 },
      etapas: [],
    };
  }

  const plan = parsePlan(readFileSync(paths.plan, "utf8"));
  const pages = pageSummaries(paths);
  // The text of each step written for the person, from the server.
  const texts = readJson(paths.texts) ?? {};
  const steps = plan.stages.flatMap((stage) => stage.steps);

  return {
    app: plan.app || String(project.name ?? basename(paths.root)),
    pronto: true,
    sincronia,
    perfil: readJson(paths.profile),
    passoDaVez: plan.currentStep,
    progresso: {
      feitos: steps.filter((step) => step.done || step.skipped).length,
      total: steps.length,
    },
    etapas: plan.stages.map((stage) => ({
      codigo: stage.code,
      nome: stage.name,
      situacao: stageStatus(stage, plan.currentStep),
      passos: stage.steps.map((step) => ({
        codigo: step.code,
        titulo: step.title,
        entrega: step.deliverable,
        quem: step.actor,
        trava: step.gate,
        condicional: step.conditional,
        situacao: stepState(step, plan.currentStep),
        pagina: pages.get(step.code) ?? null,
        texto: typeof texts[step.code] === "string" ? texts[step.code] : "",
      })),
    })),
  };
}

// ---------------------------------------------------------------- http

function send(response, status, body, headers = {}) {
  response.writeHead(status, {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
    ...headers,
  });
  response.end(body);
}

function sendJson(response, status, value) {
  send(response, status, JSON.stringify(value), {
    "content-type": mimeTypes[".json"],
  });
}

// Images, audio and video stream in pieces, so a long video starts at once.
function sendFile(request, response, file, extraHeaders = {}) {
  const size = statSync(file).size;
  const type = mimeTypes[extname(file).toLowerCase()];
  const headers = {
    "content-type": type ?? "application/octet-stream",
    "accept-ranges": "bytes",
    ...extraHeaders,
  };
  // An unknown kind of file is downloaded, never shown as a page.
  const disposition = type ? "inline" : "attachment";
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");

  if (range && size > 0) {
    const start = range[1]
      ? Number(range[1])
      : Math.max(0, size - Number(range[2]));
    const end =
      range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;

    if (start > end || start >= size) {
      send(response, 416, "", { "content-range": `bytes */${size}` });

      return;
    }

    response.writeHead(206, {
      ...headers,
      "x-content-type-options": "nosniff",
      "content-disposition": disposition,
      "content-range": `bytes ${start}-${end}/${size}`,
      "content-length": end - start + 1,
    });
    createReadStream(file, { start, end }).pipe(response);

    return;
  }

  response.writeHead(200, {
    ...headers,
    "x-content-type-options": "nosniff",
    "content-disposition": disposition,
    "content-length": size,
  });
  createReadStream(file).pipe(response);
}

function sendBundle(response, path) {
  const name = path === "/" ? "index.html" : path.slice(1);
  const file = resolve(appBundle, name);

  if (!file.startsWith(appBundle + sep) || !existsSync(file)) {
    if (path === "/") {
      send(response, 500, "A interface do painel não está no plugin.");

      return;
    }

    // Every other address is a screen of the panel.
    sendBundle(response, "/");

    return;
  }

  const type = mimeTypes[extname(file)] ?? "application/octet-stream";
  const html = type.startsWith("text/html");
  // The page names each script and style with the time it was built, so a
  // plugin update never runs next to a copy the browser kept of the old one.
  const body = html
    ? readFileSync(file, "utf8").replace(
        /(\.\/assets\/[\w.-]+\.(?:js|css))/g,
        (asset) => {
          const assetFile = join(appBundle, asset);

          return existsSync(assetFile)
            ? `${asset}?v=${Math.round(statSync(assetFile).mtimeMs)}`
            : asset;
        },
      )
    : readFileSync(file);

  send(response, 200, body, {
    "content-type": type,
    // Asks the server every time: after the plugin updates, the new screens
    // show at once. Everything is on this computer, so it costs nothing.
    "cache-control": html ? "no-store" : "no-cache",
    ...(html ? { "content-security-policy": panelPolicy } : {}),
  });
}

// ---------------------------------------------------------------- server

// How long a check of the plan with the server stays fresh. The real updates
// come from the hook that runs after each step; this only covers a panel
// opened later, or a step recorded from another computer.
const syncInterval = 5 * 60 * 1000;

export function createPanel(appFolder, options = {}) {
  const paths = appPaths(appFolder);
  let lastSync = 0;

  // Asks the server of the house where the app is, at most once in a while.
  function syncSoon() {
    if (!options.sync || Date.now() - lastSync < syncInterval) {
      return;
    }

    lastSync = Date.now();
    syncPlan(paths.root).catch(() => {
      // Offline: the panel keeps showing the last copy of the plan.
    });
  }

  const listeners = new Set();
  let lastActivity = Date.now();
  let pending = new Set();
  let timer = null;

  // One message for a burst of changes: the agent writes several files at once.
  function changed(path) {
    pending.add(path);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const message = `event: mudou\ndata: ${JSON.stringify({ caminhos: [...pending] })}\n\n`;

      pending = new Set();

      for (const listener of listeners) {
        listener.write(message);
      }
    }, 250);
  }

  const watchers = [];

  function watchFolder(folder, prefix) {
    try {
      watchers.push(
        watch(folder, { recursive: true }, (_event, name) => {
          if (name) {
            changed(`${prefix}${String(name).split(sep).join("/")}`);
          }
        }),
      );
    } catch {
      // A folder that does not exist yet is watched once the panel restarts.
    }
  }

  syncSoon();
  watchFolder(paths.method, "metodo/");
  watchFolder(dirname(paths.plan), ".metodo/");

  const server = createServer((request, response) => {
    lastActivity = Date.now();

    // Only this computer, by its own name: a page from the internet that
    // points a name of its own here is refused.
    const port = server.address()?.port;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];

    if (!allowedHosts.includes(request.headers.host ?? "")) {
      send(response, 403, "Painel só para este computador.");

      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      send(response, 405, "", { allow: "GET, HEAD" });

      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);
    const path = decodeURIComponent(url.pathname);

    try {
      if (path === "/api/saude") {
        sendJson(response, 200, { ok: true, pasta: paths.root });

        return;
      }

      if (path === "/api/estado") {
        sendJson(response, 200, readState(paths.root));

        return;
      }

      if (path.startsWith("/api/paginas/")) {
        const code = path.slice("/api/paginas/".length);
        const page = stepCode.test(code) ? readPage(paths, code) : null;

        if (!page) {
          sendJson(response, 404, { erro: "Esta página ainda não existe." });

          return;
        }

        sendJson(response, 200, page);

        return;
      }

      if (path.startsWith("/api/arquivos/")) {
        const file = insideMethod(
          paths.method,
          path.slice("/api/arquivos/".length),
        );

        if (!file) {
          send(response, 404, "Arquivo não encontrado dentro de metodo/.");

          return;
        }

        // A page of the app runs apart from the panel, without its address.
        sendFile(request, response, file, {
          "content-security-policy": "sandbox allow-scripts allow-forms",
          "cache-control": "no-cache",
        });

        return;
      }

      if (path === "/api/eventos") {
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-store",
          connection: "keep-alive",
        });
        response.write("retry: 2000\n\n");
        listeners.add(response);
        syncSoon();
        request.on("close", () => listeners.delete(response));

        return;
      }

      if (path.startsWith("/api/")) {
        sendJson(response, 404, { erro: "Endereço desconhecido." });

        return;
      }

      sendBundle(response, path);
    } catch (error) {
      sendJson(response, 500, { erro: String(error?.message ?? error) });
    }
  });

  // Keeps the live connection open through proxies and sleeping tabs.
  const heartbeat = setInterval(() => {
    for (const listener of listeners) {
      listener.write(": ping\n\n");
    }

    if (listeners.size === 0 && Date.now() - lastActivity > idleLimit) {
      close();
    }
  }, 25_000);

  heartbeat.unref();

  function close() {
    clearInterval(heartbeat);

    for (const watcher of watchers) {
      watcher.close();
    }

    for (const listener of listeners) {
      listener.end();
    }

    server.close();
  }

  return { server, close, paths };
}

// ---------------------------------------------------------------- command

async function runningPanel(paths) {
  const state = readJson(paths.state);

  if (!state?.porta) {
    return null;
  }

  try {
    const response = await fetch(`http://127.0.0.1:${state.porta}/api/saude`, {
      signal: AbortSignal.timeout(800),
    });
    const health = await response.json();

    return health.pasta === paths.root ? state : null;
  } catch {
    return null;
  }
}

function listen(server, port) {
  return new Promise((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolvePort(port);
    });
  });
}

function browserCommand(url) {
  if (process.platform === "darwin") {
    return ["open", [url]];
  }

  if (process.platform === "win32") {
    return ["cmd", ["/c", "start", "", url]];
  }

  return ["xdg-open", [url]];
}

function openBrowser(url) {
  const [command, args] = browserCommand(url);

  spawn(command, args, { stdio: "ignore", detached: true }).unref();
}

export async function startPanel(appFolder, options = {}) {
  const paths = appPaths(appFolder);
  const running = await runningPanel(paths);

  if (running) {
    return { url: `http://127.0.0.1:${running.porta}`, novo: false };
  }

  for (let port = firstPort; port <= lastPort; port += 1) {
    const panel = createPanel(paths.root, { sync: true });

    try {
      await listen(panel.server, port);
    } catch (error) {
      panel.close();

      if (error.code === "EADDRINUSE") {
        continue;
      }

      throw error;
    }

    writeFileSync(
      paths.state,
      JSON.stringify({ porta: port, pid: process.pid }, null, 2),
    );

    const forget = () => {
      if (readJson(paths.state)?.pid === process.pid) {
        rmSync(paths.state, { force: true });
      }
    };

    panel.server.on("close", forget);
    process.once("SIGINT", () => {
      panel.close();
      process.exit(0);
    });
    process.once("SIGTERM", () => {
      panel.close();
      process.exit(0);
    });

    if (options.open) {
      openBrowser(`http://127.0.0.1:${port}`);
    }

    return { url: `http://127.0.0.1:${port}`, novo: true, panel };
  }

  throw new Error(
    `As portas ${firstPort} a ${lastPort} estão ocupadas. Feche outro painel e tente de novo.`,
  );
}

// Starts the panel in a process of its own, so it keeps running after the
// command (or the session) that started it ends.
export async function startInBackground(appFolder, serverFile, options = {}) {
  const paths = appPaths(appFolder);
  const running = await runningPanel(paths);

  if (running) {
    if (options.open) {
      openBrowser(`http://127.0.0.1:${running.porta}`);
    }

    return { url: `http://127.0.0.1:${running.porta}`, novo: false };
  }

  const child = spawn(
    process.execPath,
    [serverFile, paths.root, ...(options.open ? ["--abrir"] : [])],
    { detached: true, stdio: "ignore", windowsHide: true },
  );

  child.unref();

  // Waits for the panel to answer, up to three seconds.
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((wait) => setTimeout(wait, 100));

    const started = await runningPanel(paths);

    if (started) {
      return { url: `http://127.0.0.1:${started.porta}`, novo: true };
    }
  }

  return { url: null, novo: true };
}

export function stopPanel(appFolder) {
  const paths = appPaths(appFolder);
  const state = readJson(paths.state);

  if (!state?.pid) {
    return false;
  }

  try {
    process.kill(state.pid, "SIGTERM");
  } catch {
    // Already stopped.
  }

  rmSync(paths.state, { force: true });

  return true;
}

export async function runCommand(appFolder, args, serverFile) {
  if (args.includes("parar")) {
    console.log(
      stopPanel(appFolder)
        ? "Painel do app desligado."
        : "O painel desta pasta não estava ligado.",
    );

    return;
  }

  if (args.includes("--fundo")) {
    const result = await startInBackground(appFolder, serverFile, {
      open: args.includes("--abrir"),
    });

    console.log(
      result.url
        ? `Painel do app ligado em ${result.url}`
        : "O painel não respondeu a tempo. Tente: node .metodo/painel.mjs",
    );

    return;
  }

  const result = await startPanel(appFolder, {
    open: args.includes("--abrir"),
  });

  console.log(
    result.novo
      ? `Painel do app em ${result.url} (Ctrl+C para desligar).`
      : `O painel desta pasta já está ligado em ${result.url}`,
  );
}

const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  const args = process.argv.slice(2);
  const folder = args.find((arg) => !arg.startsWith("-") && arg !== "parar");

  runCommand(
    folder ?? process.cwd(),
    args,
    fileURLToPath(import.meta.url),
  ).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
