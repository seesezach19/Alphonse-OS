import { ConsoleApp } from "../components/console-app";
import { LiveConsoleApp } from "../components/live-console-app";

export const dynamic = "force-dynamic";

export default function Home() {
  return process.env.ALPHONSE_CONSOLE_MODE === "live" ? <LiveConsoleApp /> : <ConsoleApp />;
}
