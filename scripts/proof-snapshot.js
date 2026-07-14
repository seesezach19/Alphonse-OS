import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const repository = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/(.:)/, "$1"));

function digestTree(directory) {
  const root = path.join(repository, directory);
  const files = fs.readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
    .sort((left, right) => left.localeCompare(right));
  const hash = createHash("sha256");
  for (const file of files) {
    const relative = path.relative(root, file).replaceAll("\\", "/");
    hash.update(relative).update("\0").update(fs.readFileSync(file)).update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

console.log(JSON.stringify({ kernel_source: digestTree("src"), schema: digestTree("migrations") }, null, 2));
