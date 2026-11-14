#!/usr/bin/env node
/**
 * Keep the `adb reverse` tunnels alive for the whole dev session.
 *
 * ## The problem
 *
 * A debug build talks to two servers on the developer's machine, and reaches
 * both through `adb reverse` rather than the LAN:
 *
 *   tcp:8081 → Metro, which serves the JS bundle
 *   tcp:4000 → the backend, which `EXPO_PUBLIC_API_URL` points at as
 *              http://127.0.0.1:4000
 *
 * A reverse tunnel belongs to the adb connection, not to the phone, so EVERY
 * USB interruption silently destroys both — a nudged cable, the phone
 * suspending the port to save power, a `adb kill-server` from another tool.
 * Nothing announces it; `adb devices` lists the phone again a second later as
 * though nothing happened.
 *
 * ## Why it is so confusing when it happens
 *
 * The two tunnels do not necessarily die together, and the half-dead state is
 * the one that wastes an afternoon:
 *
 * - Lose 8081 and the failure is loud and obvious. The dev client cannot fetch
 *   a bundle and says so on screen.
 * - Lose 4000 and the app launches PERFECTLY. Metro serves the bundle, the
 *   splash clears, JS runs — and then every request fails with
 *   `java.net.ConnectException: Failed to connect to /127.0.0.1:4000`. Sign-in
 *   hangs, the task list stays empty, location pings queue up locally and the
 *   dispatcher console shows the driver as inactive.
 *
 * That second case reads as "the app is not opening", and it sends you looking
 * for a bug in the app, which is the one place the problem is not.
 *
 * ## What this does
 *
 * Waits for a device, installs both tunnels, then watches the connection and
 * reinstalls them the moment a device comes back. Run it in its own terminal
 * beside Metro and forget about it:
 *
 *   npm run tunnels
 *
 * Reinstalling an existing tunnel is a no-op, so re-running is harmless and the
 * polling costs nothing measurable.
 */

const { spawnSync, execFileSync } = require('child_process');
const { existsSync } = require('fs');
const { join } = require('path');

/** Ports to forward, as [device port, host port]. */
const PORTS = [
  [8081, 8081],
  [Number(process.env.API_PORT) || 4000, Number(process.env.API_PORT) || 4000],
];

/** How often to check the device is still there, in ms. */
const POLL_MS = 3000;

/**
 * Find adb, preferring the SDK copy over whatever is on PATH.
 *
 * `ANDROID_HOME` is frequently unset on a machine where Android Studio
 * installed everything for you, so the default SDK locations are tried too
 * rather than failing with an unhelpful "adb not found".
 */
function findAdb() {
  const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';

  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === 'win32' && join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk'),
    process.platform === 'darwin' && join(process.env.HOME || '', 'Library', 'Android', 'sdk'),
    process.platform === 'linux' && join(process.env.HOME || '', 'Android', 'Sdk'),
  ].filter(Boolean);

  for (const root of roots) {
    const candidate = join(root, 'platform-tools', exe);
    if (existsSync(candidate)) return candidate;
  }

  // Last resort: trust PATH. If it is not there either, the first call reports
  // a clear ENOENT.
  return exe;
}

const adb = findAdb();

function adbOut(args) {
  try {
    return execFileSync(adb, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return '';
  }
}

/** True when exactly one device is ready — not `unauthorized` or `offline`. */
function deviceReady() {
  return adbOut(['get-state']).trim() === 'device';
}

/**
 * Which of the wanted tunnels adb currently holds.
 *
 * Checked every tick rather than assumed from device presence, because the two
 * come apart in practice: a tunnel can die while the phone stays listed in
 * `adb devices`, and the ports do not die together. The observed failure is
 * exactly that — `tcp:8081` alive, `tcp:4000` gone, device connected
 * throughout — so watching only for a disconnect would miss the one case this
 * script exists to catch.
 *
 * Output lines look like `UsbFfs tcp:8081 tcp:8081`; only the first port
 * matters for identifying the entry.
 */
function liveTunnels() {
  const listed = new Set();
  for (const line of adbOut(['reverse', '--list']).split('\n')) {
    const match = line.match(/tcp:(\d+)\s+tcp:(\d+)/);
    if (match) listed.add(`${match[1]}:${match[2]}`);
  }
  return listed;
}

/** Install any wanted tunnel adb is not already holding. Returns what it fixed. */
function repairTunnels(live) {
  const fixed = [];
  for (const [devicePort, hostPort] of PORTS) {
    if (live.has(`${devicePort}:${hostPort}`)) continue;

    const result = spawnSync(adb, ['reverse', `tcp:${devicePort}`, `tcp:${hostPort}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status === 0) {
      fixed.push(`${devicePort}→${hostPort}`);
    } else {
      const why = (result.stderr || result.stdout || 'unknown error').trim();
      console.error(`[tunnels] ✗ tcp:${devicePort} failed — ${why}`);
    }
  }
  return fixed;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(`[tunnels] using ${adb}`);
  console.log(`[tunnels] watching ${PORTS.map(([d, h]) => `tcp:${d}→tcp:${h}`).join('  ')}`);

  // Edge tracking is for the LOG only — what to repair is decided from adb's
  // actual state each tick, never from these flags.
  let wasReady = false;
  let wasHealthy = false;

  for (;;) {
    if (!deviceReady()) {
      if (wasReady) console.warn('[tunnels] ⚠ device gone — waiting for it to come back');
      wasReady = false;
      wasHealthy = false;
      await sleep(POLL_MS);
      continue;
    }

    if (!wasReady) console.log('[tunnels] device connected');
    wasReady = true;

    const live = liveTunnels();
    const missing = PORTS.filter(([d, h]) => !live.has(`${d}:${h}`));

    if (missing.length > 0) {
      // Say what was broken before fixing it. This line is the whole point of
      // the script: it is the evidence that an "app not opening" was a dead
      // tunnel rather than anything in the app.
      if (wasHealthy) {
        console.warn(
          `[tunnels] ⚠ dropped while connected: ${missing.map(([d]) => `tcp:${d}`).join(' ')}`,
        );
      }

      const fixed = repairTunnels(live);
      const healthy = fixed.length === missing.length;

      if (healthy) console.log(`[tunnels] ✅ restored — ${fixed.join('  ')}`);
      // A partial repair is the dangerous half-up state, so it is never
      // reported as healthy and is retried on the next tick.
      else console.error('[tunnels] partial — retrying');

      wasHealthy = healthy;
    } else if (!wasHealthy) {
      console.log(`[tunnels] ✅ up — ${PORTS.map(([d, h]) => `${d}→${h}`).join('  ')}`);
      wasHealthy = true;
    }

    await sleep(POLL_MS);
  }
}

main().catch((e) => {
  console.error('[tunnels] stopped:', e?.message ?? e);
  process.exit(1);
});
