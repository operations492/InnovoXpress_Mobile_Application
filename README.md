# Innovo Xpress — Driver App

A React Native (Expo SDK 57) app for Innovo Xpress couriers. It runs against the
existing `InnovoXpress-Management-System-Backend` **without any change to it** —
every endpoint used here already existed and is already driver-authorised.

Built to the four HTML mockups: Tasks, Task info, Items & packages, Complete task.

---

## 0. Demo mode — run it with no backend at all

```bash
npm install
npx expo start --go     # scan the QR with Expo Go
```

That is the whole setup. No API, no Supabase, no `.env`, no account.

The app detects that credentials are missing and runs on built-in fixtures:
three sample jobs (one not started, one part-way, one delivered), a working
sign-in that accepts anything, and the full pickup → delivery flow including
proof capture. An orange **DEMO** strip sits across the top; tapping it resets
the sample run.

The fixtures enforce the same rules the server does — forward-only status,
`PICKED_UP`/`DELIVERED` reachable only through proof, both files mandatory, 409
on an illegal move. A demo that lets you do things the real API would refuse
would teach the wrong flow.

Not simulated: GPS reporting is inert (there is nowhere to send a fix, and
asking a reviewer for background location to look at a design would be the app
taking something it has no use for), and captured proof has no signed URL to
display back.

Force it on with real credentials present by setting `EXPO_PUBLIC_DEMO=1`.

---

## 1. Getting it running against the real API

```bash
cd innovo-driver-app
npm install
cp .env.example .env      # then fill in the two Supabase values
```

`.env` needs:

| Variable | What it is |
|---|---|
| `EXPO_PUBLIC_API_URL` | The Express API. **Must be reachable from the phone** — `localhost` only works on a simulator; on a real device use your machine's LAN IP, e.g. `http://192.168.1.20:4000`. |
| `EXPO_PUBLIC_SUPABASE_URL` | Already filled in: `https://nrphdvaeujwspfohaesu.supabase.co` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | **Still a placeholder.** Supabase dashboard → Project Settings → API → `anon` `public`. |
| `GOOGLE_MAPS_API_KEY_ANDROID` | Needed for the embedded map on Android. iOS uses Apple Maps and needs nothing. |

> **Never put `SUPABASE_SERVICE_ROLE_KEY` in this file.** It bypasses every
> Supabase security rule, and anything prefixed `EXPO_PUBLIC_` is compiled into
> the JS bundle that ships to every phone. The app only ever needs the anon key —
> that key is designed to be public, and the backend verifies the resulting token
> against the project JWKS anyway.

Then:

```bash
npx expo start          # QR code; most of the app works in Expo Go
```

**Background GPS, the camera and the signature pad need a dev build**, not Expo
Go — Expo Go does not carry those native modules.

### Building locally, phone over USB (no cloud, no Expo account)

`npx expo prebuild --platform android` has already been run, so **`android/` is a
real Gradle project** — the same thing `react-native init` produces. Build it
with Android Studio's Run button, with `./gradlew`, or with `npx expo run:android`;
all three drive the same Gradle build.

One-time setup:

1. Install **Android Studio** — it bundles the JDK, the SDK and `adb`. During
   setup accept the SDK and "Android SDK Platform-Tools".
2. On the phone: **Settings → About phone → tap Build number seven times**, then
   **Settings → Developer options → USB debugging: on**.
3. Plug the phone in and accept the "Allow USB debugging?" prompt. Check it is
   seen: `adb devices` should list it as `device`, not `unauthorized`.

Then, from the project root:

```bash
npx expo run:android
```

That compiles, installs and launches on the connected phone, and starts Metro.
Afterwards `npx expo start` alone is enough — JS changes reload without rebuilding.

An emulator works identically: create one in Android Studio's **Device Manager**,
start it, and run the same command.

> **`android/` is gitignored**, which is Expo's continuous-native-generation
> convention: the folder is an output of `app.config.ts`, not a source. So
> `prebuild --clean` regenerates it and **discards hand edits to native files**.
> Change permissions and plugins in `app.config.ts` and re-run prebuild. If you
> would rather own the native code by hand, remove `/android` from `.gitignore`
> and stop running prebuild.

### Building the APK in the cloud (no Android Studio)

```bash
npm i -g eas-cli
eas login                        # free Expo account
eas init                         # writes extra.eas.projectId into app.json
eas build --profile development --platform android
```

EAS builds it on their servers (~10-20 min on the free tier) and gives you a URL.
Open that URL **on the phone**, download, install — Android will ask you to allow
installing from unknown sources.

Then, on the PC:

```bash
npx expo start --dev-client
```

Open the installed app and it connects to your Metro bundler.

**Build once, then never again** unless you add a native module or change
`app.config.ts`. All JS/TS changes hot-reload from Metro.

#### Which profile

| Profile | What you get | Where env comes from |
|---|---|---|
| `development` | Dev-client APK. Needs Metro running on the PC. Live reload. | Your local `.env`, at bundle time |
| `preview` | Standalone APK. Runs on its own, no PC needed. | The `env` block in `eas.json` |
| `production` | AAB for the Play Store | The `env` block in `eas.json` |

The `development` profile is the one to use while building the app: your `.env`
stays on your machine and never reaches Expo's servers.

For `preview` and `production` you must fill the `env` block in `eas.json` —
`.env` is gitignored and is **not** uploaded to EAS. Put only `EXPO_PUBLIC_*`
values and the Maps key there; anything secret belongs in
`eas env:create` instead, never in a file that ships.

Env values are inlined at build time, so after editing `.env` restart with
`npx expo start -c` — a running bundler will not pick up a new value.

### Checks

```bash
npm run typecheck       # tsc --noEmit
npx expo-doctor         # 21/21 at time of writing
```

---

## 2. What it does

| Screen | File | Backend |
|---|---|---|
| Sign in | `app/sign-in.tsx` | Supabase Auth directly |
| Tasks (the run) | `app/(tabs)/index.tsx` | `GET /api/drivers/me/consignments` |
| Map of the run | `app/(tabs)/map.tsx` | one `GET /api/consignments/:id` per job |
| History | `app/(tabs)/history.tsx` | `…/me/consignments?includeDelivered=true` |
| Profile · shift · GPS queue | `app/(tabs)/more.tsx` | `GET /api/auth/me`, `POST /api/drivers/me/shift` |
| Task info | `app/task/[id]/index.tsx` | `GET /api/consignments/:id`, `PATCH /:id/status` |
| Items & packages | `app/task/[id]/items.tsx` | `GET /api/consignments/:id` |
| Proof capture | `app/task/[id]/complete.tsx` | `POST /api/consignments/:id/pod/:leg` |

Plus position reporting while on shift → `POST /api/drivers/me/locations`.

That is **every driver-reachable route on the API**. Nothing else is called,
because nothing else answers a driver token with anything but 403.

### The job lifecycle

The sticky button at the bottom of Task info always shows the one next step, and
which step that is comes from the server:

```
ASSIGNED ──Start Pickup──► EN_ROUTE_TO_PICKUP ──Arrive──► AT_PICKUP
                                                             │ photo + signature
                                                             ▼
DELIVERED ◄──photo + signature── AT_DELIVERY ◄──Arrive── EN_ROUTE_TO_DELIVERY ◄──Start Delivery── PICKED_UP
```

The four "travelling / arrived" edges go through `PATCH /status`. **`PICKED_UP`
and `DELIVERED` do not** — the request schema rejects those words. They happen
only when a photo *and* a signature upload succeeds, and the server changes the
status inside the same transaction that stores the proof, so the two can never
disagree.

`src/features/tasks/statusFlow.ts` mirrors that machine so the button can be
labelled before the network answers. It is a mirror, not an authority: the server
re-checks every edge and answers 409, and the screen refetches rather than argues.

### Proof of delivery

Both files are mandatory and the server sniffs the actual bytes rather than
trusting the declared content type. The screen therefore keeps Save inert until
both exist, and says which one is missing.

Every capture carries an `Idempotency-Key`, minted **when the screen opens, not
when Save is pressed**. A tap that times out on a bad signal and is tapped again
replays the same key and gets the stored proof back with a 200, instead of
"already captured" with a 409.

The mockup's *Recipient* field has no column behind it — the POD endpoint accepts
only `capturedByDriverId` and `note` — so the name is folded into the note as
`Received by <name> — <note>`. It lands on the record where dispatch can read it
rather than nowhere.

### Shift and position

Clocking on is not cosmetic: the backend **refuses to assign work to an off-shift
driver** with a 409. Clocking on requests location permission, calls
`POST /me/shift`, then starts background reporting; clocking off stops it.

- Fixes are buffered to disk and flushed in batches of up to 200 — a courier
  spends real time in underground bays, and the API takes a batch precisely
  because one request per point would drop most of the trail.
- The queue depth is visible on the **More** tab, with a manual "send now". GPS
  failures are silent by nature; a driver buffering for two hours has no other
  way to find out.
- `onShift` is read from the server, not a local flag — an admin deactivating a
  driver, or the 04:00 `pg_cron` job closing an abandoned shift, both change it
  behind the app's back. On launch the app makes the device agree with the API.
- **Off shift, nothing is reported.** That is a privacy commitment, not an
  optimisation.

---

## 3. Things that are absent on purpose

- **Chat tab.** `/api/chat` is operator-and-admin only; drivers are excluded by
  design on the backend. A Chat tab could only ever show a 403.
- **Vehicle tab.** No table, no endpoint, no data.
- **Barcode scanning** on the capture screen. There is no field to store a scan
  against, so the button would do nothing that survives the request.
- **Editing an order, or seeing anyone else's.** `GET /api/consignments` is
  operator+; a driver may read exactly the jobs assigned to them.
- **Undo.** The lifecycle is forward-only and there is no `CANCELLED` or
  `FAILED` — the user's explicit choice. A mis-captured proof is replaced by an
  admin in the console.
- **Realtime subscriptions.** The live topics (`dispatch:tasks`,
  `dispatch:drivers`) are the dispatcher's. The list polls every 45s and refetches
  on focus and on reconnect, which is the same safety net the console runs
  underneath its subscription.

Each of these is a one-session addition the day the backend grows the feature.

---

## 4. Layout

```
app/                      expo-router routes (see the table above)
src/
  api/       client.ts    fetch + token injection + one 401 refresh-and-retry
             types.ts     the wire contract, hand-written from the backend DTOs
             endpoints.ts every driver-reachable route, and nothing else
  features/
    tasks/   statusFlow   mirror of the server state machine
             queries      TanStack Query hooks and cache invalidation
    pod/     capture      camera, library, signature → upload files
    location/tracking     background task, permissions, flush
             buffer       offline queue on disk
  state/     AuthProvider Supabase session
             ShiftProvider shift ↔ GPS, reconciled against the server
  components/              UI primitives transcribed from the mockups
  theme/tokens.ts          the "Iris" tokens, 1:1 from the mockup CSS
```

**Design tokens are literal.** If a colour is not in `theme/tokens.ts`, it is not
in the design — that is what stops a screen inventing a near-miss shade.

Session storage is the **Keychain / Keystore**, not AsyncStorage: the refresh
token can mint access tokens for weeks, and on a courier's phone that is the
credential to a live account. It is chunked because SecureStore warns above 2048
bytes and a Supabase session exceeds it (`src/lib/secureStorage.ts`).

---

## 5. Known gaps

- **`GET /api/drivers/me/consignments` returns no coordinates.** The list
  projection omits `senderLat/Lng`; only the detail endpoint has them. The Map
  tab therefore fans out one detail read per job. Fine for a driver's handful of
  stops, and the reads are cached under the same keys the Task screen uses, so
  opening a job from the map is instant. Adding the four columns to that
  projection would remove the fan-out — a backend change, so it was not made.
- **`items[].weightKg` is a Prisma `Decimal`** and arrives as a JSON *string*
  from the list endpoint but a *number* from the detail endpoint. Both are
  accepted and normalised by `toNumber()` in `src/lib/format.ts`.
- **The map needs a Google Maps key on Android.** Without one the map area
  renders blank; everything else, including Navigate, works — it deep-links to
  whichever map app the driver has.
- **Not yet run on a device.** Types, the Metro bundle for Android and
  `expo-doctor` all pass; the camera, signature pad and background GPS need a dev
  build on real hardware to be called verified.
- **No test suite.** Matching the existing driver app, which also has none.
