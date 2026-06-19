# Voice Assistant — natural-language control & queries (OpenAI)

**Date:** 2026-06-19
**Status:** Approved, implementing

A household voice/text assistant that turns free-form language ("dim the living
room lights and arm security", "what's on my schedule today?") into concrete
actions and answers. It reuses the proven connectors pattern: the OpenAI key
stays server-side, the model returns a **structured plan**, and all execution
flows through the existing `useActions` functions so Deako hardware pushes,
toasts, automations, admin-gating, and alerts keep working unchanged.

It wires up the previously dead **"Voice"** button in the Smart Home header.

## Interaction model

- **Text + Voice.** A chat-style command box always works. A mic button uses the
  browser Web Speech API (`SpeechRecognition`) to dictate into the box when
  available; if unsupported, the mic is hidden and typing still works.
- **Spoken replies (TTS).** A toggle (off by default) speaks the assistant's
  reply via `SpeechSynthesis`.

## Architecture

| File | Responsibility |
|------|----------------|
| `lib/assistant/intents.ts` (new, pure, shared) | Intent type union + defensive `parseActions(json)` validator. Malformed intents are dropped. |
| `lib/assistant/context.ts` (new, pure) | `buildContext(state)` → compact JSON snapshot for the model (room/light/device/scene/member names + states, thermostat, security, today's events). Also exports name→id resolver maps. |
| `lib/assistant/resolve.ts` (new, pure) | Case-insensitive fuzzy resolvers: name → light/device/room/scene/member id. Used by both the answer helper and the client executor. |
| `lib/assistant/answer.ts` (new, pure) | Answers read-only query intents from the snapshot → human strings. |
| `lib/ai/assistant.ts` (new, server-only) | OpenAI call (mirrors `lib/ai/extract.ts`): system prompt, `temperature 0`, `response_format json_object`, 45s timeout. Returns `{ reply, actions }` or a typed failure. |
| `app/api/assistant/route.ts` (new) | POST `{ text, context }` → `{ ok, reply, actions }`. nodejs runtime, auth-protected like other routes. |
| `hooks/useAssistant.tsx` (new) | Client executor: dispatch control intents via `useActions`, manage the confirm queue, build preview chips, drive TTS. |
| `hooks/useSpeechInput.ts` (new) | Thin Web Speech API wrapper: start/stop, transcript callback, `supported` flag. |
| `components/views/assistant/AssistantPanel.tsx` (new) | Slide-over panel: transcript, input box, mic button, TTS toggle, confirm/preview chips. |
| `components/views/Home.tsx` (modify) | Wire the "Voice" button to open the panel. |
| App shell (modify) | Mount `AssistantPanel` once so it is reachable everywhere; open state lives in the household UI store. |
| `test/assistant.test.js` (new) | Pure unit tests (node --test). |

## Data flow

1. User types or dictates a command → appended to the transcript.
2. Client POSTs `{ text, context: buildContext(state) }` to `/api/assistant`.
3. Server calls OpenAI with a system prompt enumerating the intents and the
   required JSON shape. Returns `{ reply: string, actions: Intent[] }`.
4. Client runs `parseActions` (drops malformed) then partitions intents:
   - **Query** intents → answered locally via `answer.ts`; results fold into the
     displayed reply.
   - **Control, routine** → applied immediately through `useActions`.
   - **Control, sensitive** → held as pending; rendered as a confirm chip.
5. Transcript shows the reply plus one **preview chip per intent**:
   `✓ Turned off 3 lights`, `⏳ Confirm: Disarm security`, `⛔ Admin only`,
   `❓ Couldn't find "garage lamp"`.
6. Clicking a confirm chip applies that pending intent. If TTS is on, the reply
   is spoken.

## Intent registry

**Control** (routed to existing `useActions`):

- `lights.set { room?: string | "all", on: boolean }` → `allLights` / per-room
- `lights.toggle { name: string }` → `toggleLight`
- `lights.brightness { name?: string, room?: string, value: number }` → `setBrightness`
- `scene.activate { name: string }` → `activateScene`
- `thermostat { target?: number, delta?: number, mode?: string, on?: boolean }` → `adjTemp` / `setThermoMode` / `toggleThermo`
- `security.arm { value: boolean }` → `toggleArm`
- `lock.set { name: string, locked: boolean }` → `toggleLock`
- `device.set { name: string, on: boolean }` → `toggleDevice`

**Query** (answered locally, no mutation):

- `query.home` — what's on, doors locked, temperature, security status
- `query.schedule { when?: "today" | "tomorrow" | "YYYY-MM-DD", member?: string }`
- `query.finance` — balance / recent spending / budget basics
- `query.weather` — current conditions from state

Anything else → no action; the `reply` string carries the response.

## Safety & gating

- **Sensitive intents require confirmation:** disarm security (`security.arm`
  with `value:false`), unlock a lock (`lock.set` with `locked:false`), and any
  "all/everything off" (`lights.set {room:"all", on:false}`). These render a
  pending confirm chip and apply only on click. All other control intents apply
  directly.
- **Admin gating:** `security.arm` and `lock.set` check `isAdmin(state, userId)`.
  A non-admin gets a refusal chip + reply and the intent is not dispatched. (The
  underlying `useActions` already enforces this with a toast; the executor checks
  first so the assistant can answer politely without a stray toast.)
- **Transparency:** every intent yields a preview chip describing the outcome.

## Error handling

- No `OPENAI_API_KEY` → route returns `{ ok:false, reason:"ai-unavailable" }`;
  the panel shows "Assistant needs an OpenAI key" (same copy pattern as
  connectors).
- OpenAI error/timeout → `{ ok:false, reason:"ai-error" }`; panel shows
  "I couldn't reach the assistant — try again."
- All intents dropped by the validator → the `reply` is still shown.
- Web Speech API unsupported → mic hidden; text path unaffected.

## Testing / verification

- Pure unit tests (`node --test`, `test/assistant.test.js`), mirroring
  `test/connector-extract.test.js`:
  - `parseActions` keeps valid intents and drops malformed ones.
  - name resolvers match case-insensitively and report ambiguity/not-found.
  - `buildContext` includes the expected names/states and stays compact.
  - `answer.ts` produces correct strings for each query intent.
- Typecheck + build green.
- Manual: "turn off the living room lights" (direct), "what's on the schedule
  today" (query), "arm security" (direct), "disarm" (confirm), and a non-admin
  member attempting disarm (refusal).

## Out of scope (YAGNI)

- Multi-turn conversational memory / follow-up context.
- OpenAI function-calling round-trip loops (single-shot structured plan only).
- Server-side state mutation (all execution stays on the client path).
- Cloud speech-to-text or non-browser TTS voices.
