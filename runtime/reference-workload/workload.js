import { access, readFile, readdir, readlink, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import jsonLogic from "json-logic-js";

async function read(path) {
  return (await readFile(path, "utf8")).trim();
}

async function rootIsReadOnly() {
  try {
    await writeFile("/workload/root-write-test", "forbidden");
    await unlink("/workload/root-write-test");
    return false;
  } catch (error) {
    return ["EACCES", "EROFS"].includes(error.code);
  }
}

async function socketAbsent() {
  try {
    await access("/var/run/docker.sock", constants.F_OK);
    return false;
  } catch {
    return true;
  }
}

const status = await read("/proc/self/status");
const capEff = status.match(/^CapEff:\s+(.+)$/m)?.[1] ?? "unknown";
const namespaceId = await readlink("/proc/self/ns/pid").catch(() => "unavailable");
const processStat = await read("/proc/self/stat");
const interfaces = await readdir("/sys/class/net");
await writeFile("/scratch/probe", "bounded scratch");

let inputText = "";
for await (const chunk of process.stdin) inputText += chunk;
let comparison = null;
if (inputText.trim()) {
  const input = JSON.parse(inputText);
  const quantities = Object.fromEntries(input.observations.map((entry) => [`${entry.source}_quantity`, entry.quantity]));
  comparison = Object.fromEntries(Object.entries(input.program)
    .map(([output, rule]) => [output, jsonLogic.apply(rule, quantities)]));
}

const result = {
  workload_grant_id: process.env.WORKLOAD_GRANT_ID,
  workload_nonce: process.env.WORKLOAD_NONCE,
  boundary_checks: {
    non_root: process.getuid() !== 0,
    root_read_only: await rootIsReadOnly(),
    scratch_writable: (await read("/scratch/probe")) === "bounded scratch",
    docker_socket_absent: await socketAbsent(),
    effective_capabilities_zero: /^0+$/.test(capEff),
    network_default_denied: interfaces.every((name) => name === "lo")
  },
  identity: {
    namespace_id: namespaceId,
    cgroup_path: await read("/proc/self/cgroup"),
    boot_id: await read("/proc/sys/kernel/random/boot_id"),
    start_identity: processStat.split(" ")[21],
    workload_nonce: process.env.WORKLOAD_NONCE
  },
  comparison
};

if (Object.values(result.boundary_checks).some((passed) => !passed)) process.exitCode = 2;
process.stdout.write(`${JSON.stringify(result)}\n`);
