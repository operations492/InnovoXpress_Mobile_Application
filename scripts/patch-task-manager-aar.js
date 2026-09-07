#!/usr/bin/env node
/**
 * Stop `expo-task-manager` asking for a PERSISTED JobScheduler job.
 *
 * ## The crash
 *
 * On Transsion phones (Infinix, Tecno, itel) the app dies with nothing in the
 * Metro logs:
 *
 *   FATAL EXCEPTION: main
 *   Unable to start receiver expo.modules.taskManager.TaskBroadcastReceiver:
 *   java.lang.IllegalArgumentException: Error: requested job be persisted
 *       without holding RECEIVE_BOOT_COMPLETED permission.
 *
 * The throw is inside a BroadcastReceiver, so it kills the process before the
 * React Native bridge exists — no JavaScript runs and there is nothing to see on
 * the JS side. It also self-perpetuates: the location service outlives the app
 * (`killServiceOnDestroy: false`), so a fix is always queued for delivery and
 * every relaunch dies the same way.
 *
 * ## Why the obvious fixes do not work
 *
 * - `RECEIVE_BOOT_COMPLETED` IS declared and `dumpsys package` reports
 *   `granted=true`. These ROMs gate background scheduling behind their own
 *   auto-start list, independently of the AOSP permission, and refuse anyway.
 *   The per-device auto-start toggle helps only until the OS next kills the app.
 * - There is no option to avoid it: BOTH delivery paths in expo-location's
 *   `LocationTaskConsumer` — foreground `reportLocationsImmediately` and
 *   background `maybeReportDeferredLocations` — end at `scheduleJob`.
 * - Patching the module's Java source does nothing. SDK 57 ships a PRECOMPILED
 *   `.aar` in `local-maven-repo`, and Gradle links that binary, so the source in
 *   `android/src/main/java` is never compiled.
 * - `expo.autolinking.buildFromSource` fails: the module's `build.gradle`
 *   depends on `:unimodules-app-loader`, which only exists inside Expo's own
 *   monorepo.
 * - Upgrading does not help; 57.0.16 still hardcodes `setPersisted(true)`.
 *
 * So the compiled artifact is the only place left to change.
 *
 * ## What this does
 *
 * Flips the single `iconst_1` feeding `JobInfo.Builder.setPersisted(Z)` to
 * `iconst_0`, inside the prebuilt AAR. Persistence means exactly one thing: the
 * job survives a device reboot. This app re-registers location tracking on every
 * launch (`ShiftProvider`), so nothing is preserved across a reboot that is not
 * rebuilt seconds later anyway.
 *
 * ## Why this is safe to run
 *
 * It refuses to guess. The `setPersisted` method reference is located by walking
 * the class file's constant pool rather than by a hardcoded index, and the edit
 * is applied ONLY if the resulting `iconst_1 + invokevirtual` byte pattern
 * occurs exactly once. Any other count aborts with a non-zero exit rather than
 * silently corrupting a class.
 *
 * Verify by hand at any time with:
 *
 *   javap -c -p expo/modules/taskManager/TaskManagerUtils.class | grep -B2 setPersisted
 *
 * which must show `iconst_0` on the line above the `setPersisted` call.
 *
 * ## When to delete this
 *
 * If a future `expo-task-manager` makes persistence configurable, or builds from
 * source cleanly, drop this script and the `postinstall` hook. It is deliberately
 * loud on every SDK bump: if the bytecode shape changes it fails the install
 * rather than leaving you with a crash that only appears on a driver's phone.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MODULE = 'expo-task-manager';
const CLASS_ENTRY = 'expo/modules/taskManager/TaskManagerUtils.class';
const METHOD = 'setPersisted';

const ICONST_0 = 0x03;
const ICONST_1 = 0x04;
const INVOKEVIRTUAL = 0xb6;

/** Constant-pool tags and how many bytes each entry's payload occupies. */
const FIXED_WIDTH = {
  3: 4, // Integer
  4: 4, // Float
  5: 8, // Long   (consumes two pool slots)
  6: 8, // Double (consumes two pool slots)
  7: 2, // Class
  8: 2, // String
  9: 4, // Fieldref
  10: 4, // Methodref
  11: 4, // InterfaceMethodref
  12: 4, // NameAndType
  15: 3, // MethodHandle
  16: 2, // MethodType
  17: 4, // Dynamic
  18: 4, // InvokeDynamic
  19: 2, // Module
  20: 2, // Package
};

/**
 * Read the constant pool into a sparse array. Only the shapes this script needs
 * are decoded; everything else is skipped by width.
 */
function readConstantPool(buf) {
  const count = buf.readUInt16BE(8);
  const pool = new Array(count);
  let off = 10;

  for (let i = 1; i < count; i += 1) {
    const tag = buf[off];
    off += 1;

    if (tag === 1) {
      const len = buf.readUInt16BE(off);
      pool[i] = { tag, text: buf.toString('utf8', off + 2, off + 2 + len) };
      off += 2 + len;
      continue;
    }

    const width = FIXED_WIDTH[tag];
    if (width === undefined) throw new Error(`Unknown constant pool tag ${tag} at index ${i}`);

    if (tag === 10 || tag === 11 || tag === 12) {
      pool[i] = { tag, a: buf.readUInt16BE(off), b: buf.readUInt16BE(off + 2) };
    }

    off += width;
    // Long and Double each take two slots; the second is unusable.
    if (tag === 5 || tag === 6) i += 1;
  }

  return pool;
}

/** Every Methodref index whose name is `setPersisted`. */
function methodRefIndexes(pool) {
  const found = [];
  for (let i = 1; i < pool.length; i += 1) {
    const entry = pool[i];
    if (!entry || entry.tag !== 10) continue;
    const nameAndType = pool[entry.b];
    if (!nameAndType || nameAndType.tag !== 12) continue;
    const name = pool[nameAndType.a];
    if (name && name.tag === 1 && name.text === METHOD) found.push(i);
  }
  return found;
}

function fail(message) {
  console.error(`\n[patch-task-manager-aar] ${message}\n`);
  process.exit(1);
}

/**
 * Throw away Gradle's extracted copies of this artifact.
 *
 * This is not belt-and-braces; it is the half that was actually missing. Gradle
 * unpacks every AAR into `caches/<version>/transforms/<hash>/…/jars/classes.jar`
 * and reuses that copy. Patching the AAR in place leaves its Maven coordinates
 * untouched (still 57.0.11), so a build that had already resolved the artifact
 * happily keeps linking the OLD extracted jar — and ships the crash from a
 * source tree that looks correct in every way.
 *
 * That is exactly what happened here: two transforms existed side by side, one
 * holding `iconst_1` and one holding `iconst_0`.
 *
 * Deleting them costs one re-extraction on the next build and removes a class of
 * failure that is close to impossible to diagnose from the symptom.
 *
 * Best-effort by design: a locked or absent cache must never fail `npm install`.
 */
function purgeGradleTransforms() {
  const home = process.env.GRADLE_USER_HOME || path.join(os.homedir(), '.gradle');
  const caches = path.join(home, 'caches');
  if (!fs.existsSync(caches)) return;

  const removed = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (entry.name.startsWith('expo.modules.taskmanager-')) {
        // Delete the whole transform workspace this sits in, not just the
        // artifact folder, so Gradle treats the transform as absent.
        const workspace = full.split(`${path.sep}workspace${path.sep}`)[0];
        try {
          fs.rmSync(workspace, { recursive: true, force: true });
          removed.push(path.basename(workspace));
        } catch {
          /* locked by a running daemon — the next clean build will redo it */
        }
        continue;
      }
      walk(full, depth + 1);
    }
  };

  for (const entry of fs.readdirSync(caches, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(path.join(caches, entry.name, 'transforms'), 0);
  }

  if (removed.length) {
    console.log(
      `[patch-task-manager-aar] cleared ${removed.length} stale Gradle transform(s) of the artifact`,
    );
  }
}

function findAar() {
  const root = path.join(__dirname, '..', 'node_modules', MODULE, 'local-maven-repo');
  if (!fs.existsSync(root)) return null;

  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith('.aar')) return full;
    }
  }
  return null;
}

function main() {
  const aar = findAar();
  if (!aar) {
    // A future SDK may stop shipping a prebuilt artifact, which would mean the
    // source is compiled and this script is obsolete. Say so rather than fail.
    console.log(`[patch-task-manager-aar] no prebuilt ${MODULE} AAR found — nothing to do`);
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ix-tm-'));
  const run = (...args) => execFileSync('jar', args, { cwd: tmp, stdio: 'pipe' });

  try {
    fs.copyFileSync(aar, path.join(tmp, 'm.aar'));
    run('xf', 'm.aar', 'classes.jar');
    run('xf', 'classes.jar', CLASS_ENTRY);

    const classPath = path.join(tmp, CLASS_ENTRY);
    if (!fs.existsSync(classPath)) fail(`${CLASS_ENTRY} not found inside the AAR`);

    const buf = fs.readFileSync(classPath);
    const refs = methodRefIndexes(readConstantPool(buf));
    if (refs.length !== 1) {
      fail(`expected exactly one \`${METHOD}\` method reference, found ${refs.length}`);
    }

    const hi = (refs[0] >> 8) & 0xff;
    const lo = refs[0] & 0xff;
    const patched = Buffer.from([ICONST_0, INVOKEVIRTUAL, hi, lo]);
    const original = Buffer.from([ICONST_1, INVOKEVIRTUAL, hi, lo]);

    if (buf.includes(patched) && !buf.includes(original)) {
      console.log(`[patch-task-manager-aar] already patched — setPersisted(false)`);
      purgeGradleTransforms();
      return;
    }

    const sites = [];
    for (let i = buf.indexOf(original); i !== -1; i = buf.indexOf(original, i + 1)) sites.push(i);
    if (sites.length !== 1) {
      fail(`expected exactly one \`setPersisted(true)\` call site, found ${sites.length}`);
    }

    buf[sites[0]] = ICONST_0;
    fs.writeFileSync(classPath, buf);

    run('uf', 'classes.jar', CLASS_ENTRY);
    run('uf', 'm.aar', 'classes.jar');
    fs.copyFileSync(path.join(tmp, 'm.aar'), aar);

    console.log(`[patch-task-manager-aar] patched setPersisted(true) -> false in ${path.basename(aar)}`);
    purgeGradleTransforms();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
