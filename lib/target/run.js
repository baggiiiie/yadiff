import { spawn, spawnSync } from 'node:child_process';

/**
 * Run a command synchronously. Returns trimmed stdout.
 * Throws on non-zero exit.
 */
export function runCommandSync(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `${command} ${args.join(' ')} failed`).trim());
  }
  return result.stdout.trim();
}

/**
 * Run a command asynchronously. Resolves with stdout string.
 * Rejects on non-zero exit.
 */
export function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', (chunk) => stdout.push(chunk));
    child.stderr.on('data', (chunk) => stderr.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdout).toString('utf8'));
        return;
      }
      reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || `${command} ${args.join(' ')} failed (${code})`));
    });
  });
}

/**
 * Try a synchronous function, return undefined on throw.
 */
export function trySync(fn) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/**
 * Run a command synchronously and return whether it exited with code 0.
 * Does not throw — intended for probing whether a command succeeds.
 */
export function runProbe(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  return result.status === 0;
}
