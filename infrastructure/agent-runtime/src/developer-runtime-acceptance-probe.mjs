import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import process from "node:process";
import { clearInterval, setInterval } from "node:timers";

const readyPath = process.argv[2];
if (readyPath === undefined || !readyPath.startsWith("/tmp/")) {
  process.exitCode = 2;
} else {
  const sudo = spawnSync("/usr/bin/sudo", ["-n", "/usr/bin/true"], {
    env: {
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    },
    shell: false,
    stdio: "ignore",
  });
  if (sudo.status !== 0) {
    process.exitCode = 3;
  } else {
    writeFileSync(
      readyPath,
      `${JSON.stringify({
        uid: process.getuid(),
        gid: process.getgid(),
        cwd: process.cwd(),
        umask: process.umask().toString(8).padStart(4, "0"),
        sudoNonInteractive: true,
      })}\n`,
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    const keepAlive = setInterval(() => undefined, 1_000);
    const stop = () => {
      clearInterval(keepAlive);
      process.exit(0);
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
}
