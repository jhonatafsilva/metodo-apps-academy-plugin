// The identification of this computer for the Método Apps Academy. The key
// of the person works on one computer only, and the server knows which by
// this value, sent in X-Metodo-Instalacao. It is made once, at random, and
// kept in the home folder, so it survives plugin updates.
//
// Run as a command, it prints the header for the connector (headersHelper).
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const folder = join(homedir(), ".metodo-apps-academy");
const file = join(folder, "instalacao");
const pattern = /^[A-Za-z0-9-]{16,64}$/;

export function installationId() {
  if (existsSync(file)) {
    const saved = readFileSync(file, "utf8").trim();

    if (pattern.test(saved)) {
      return saved;
    }
  }

  const created = randomUUID();

  mkdirSync(folder, { recursive: true, mode: 0o700 });
  writeFileSync(file, `${created}\n`, { mode: 0o600 });

  return created;
}

export const installationHeader = "X-Metodo-Instalacao";

const invokedDirectly =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  process.stdout.write(
    JSON.stringify({ [installationHeader]: installationId() }),
  );
}
