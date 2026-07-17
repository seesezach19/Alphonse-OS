import { chown, mkdir } from "node:fs/promises";

for (const directory of process.argv.slice(2)) {
  await mkdir(directory, { recursive: true });
  await chown(directory, 1000, 1000);
}
