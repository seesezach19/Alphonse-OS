export type Reachability = "checking" | "reachable" | "unavailable" | "not_configured";

export type ConnectionProbe = {
  state: Reachability;
  label: string;
  detail: string;
};

export type ConsoleConnectionStatus = {
  schema_version: "alphonse.console.connection-status.v0.1";
  checked_at: string;
  data_mode: "fixture";
  kernel: ConnectionProbe;
  diagnostic: ConnectionProbe;
  n8n: ConnectionProbe;
};

export const checkingConnectionStatus: ConsoleConnectionStatus = {
  schema_version: "alphonse.console.connection-status.v0.1",
  checked_at: "",
  data_mode: "fixture",
  kernel: { state: "checking", label: "Checking", detail: "Waiting for the console server" },
  diagnostic: { state: "checking", label: "Checking", detail: "Waiting for the console server" },
  n8n: { state: "checking", label: "Checking", detail: "Waiting for the console server" },
};
