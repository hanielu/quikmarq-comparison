const children: Bun.Subprocess[] = [];
let stopping = false;

export function launch(command: string[], cwd: string, env: Record<string, string>) {
  const child = Bun.spawn(command, {
    cwd,
    env: { ...process.env, ...env },
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
    detached: true,
  });
  children.push(child);
  child.exited.then((code) => {
    if (!stopping) stopProcesses(code || 1);
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Child process failed.');
    stopProcesses(1);
  });
  return child;
}

export function stopProcesses(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  const terminate = (signal: NodeJS.Signals) => {
    for (const child of children) {
      if (child.exitCode !== null) continue;
      try { process.kill(-child.pid, signal); } catch { child.kill(signal); }
    }
  };
  terminate('SIGTERM');
  const timer = setTimeout(() => { terminate('SIGKILL'); process.exit(exitCode); }, 5000);
  Promise.all(children.map((child) => child.exited))
    .then(() => { clearTimeout(timer); process.exit(exitCode); })
    .catch(() => process.exit(exitCode));
}

process.on('SIGINT', () => stopProcesses());
process.on('SIGTERM', () => stopProcesses());
