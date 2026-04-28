# Diduny Chrome Extension — Implementation Plan

---

# PART 1: MVP (Current Proxy Auth + Core Recording)

Мінімальна версія: OTP через поточний proxy, voice dictation, meeting recording. Перевірити що все працює.

## Architecture

| Context | Role |
|---------|------|
| **Background SW** | Tab capture API, offscreen lifecycle, message routing |
| **Offscreen Document** | Audio capture, mixing, PCM encoding, WebSocket streaming |
| **Side Panel** | Auth UI, recording controls, transcript display |

## Project Setup

**Framework:** [WXT](https://wxt.dev) with TypeScript + React

```
diduny-extension/
├── wxt.config.ts
├── package.json, tsconfig.json, biome.json
├── entrypoints/
│   ├── background.ts
│   ├── sidepanel/
│   │   ├── index.html, main.tsx, App.tsx, style.css
│   │   ├── components/  (AuthScreen, RecordingControls, TranscriptView)
│   │   └── hooks/       (useAuth, useRecording, useTranscript)
│   └── offscreen/
│       ├── index.html
│       └── main.ts
├── lib/
│   ├── api/
│   │   ├── client.ts           # fetch wrapper, Bearer token, 401 refresh
│   │   ├── auth.ts             # send-otp, verify-otp, refresh
│   │   └── transcription.ts    # POST /transcriptions (multipart)
│   ├── audio/
│   │   ├── pcm-worklet.ts      # AudioWorkletProcessor (Float32 → Int16)
│   │   ├── mixer.ts            # Web Audio API tab+mic mixing
│   │   └── encoder.ts          # PCM s16le chunk accumulator
│   ├── realtime/
│   │   └── ws-client.ts        # WebSocket client for proxy
│   ├── auth/
│   │   └── token-manager.ts    # chrome.storage + chrome.alarms refresh
│   ├── messaging/
│   │   ├── types.ts            # Discriminated union message types
│   │   └── bridge.ts           # Typed send/listen helpers
│   └── types.ts
└── public/icons/
```

**Manifest permissions:** `sidePanel`, `tabCapture`, `offscreen`, `storage`, `activeTab`

## Auth Flow (Current Proxy OTP)

```
1. Side panel: email input → POST /api/v1/auth/send-otp { email }
2. OTP input → POST /api/v1/auth/verify-otp { email, otp }
3. Response: { accessToken, refreshToken, user: { id, email } }
4. Tokens stored in chrome.storage.local
5. chrome.alarms at 14 min → POST /api/v1/auth/refresh { refreshToken }
6. On 401: attempt refresh, if fails → show login
```

## Recording Flows

### Voice Dictation (Real-time)
1. Side panel → `start-voice-recording` → Background
2. Background creates offscreen document (reasons: `USER_MEDIA`, `AUDIO_PLAYBACK`)
3. Offscreen: `getUserMedia({ audio: true })` → `AudioContext(16kHz)` → `AudioWorkletNode` (PCM s16le)
4. Offscreen: WebSocket to `wss://diduny-ears-proxy.fly.dev/api/v1/realtime?token=<accessToken>`
5. Send config JSON → wait `{ type: "proxy_ready" }` (10s) → stream PCM frames (~100ms, 3200 bytes)
6. Tokens relayed: offscreen → background → side panel (live display)
7. Stop: `{ type: "finalize" }` + empty binary → wait `{ finished: true }` (5s)
8. Copy transcript to clipboard

### Voice Dictation (Async, fallback)
`MediaRecorder` (audio/webm) → blob → `POST /api/v1/transcriptions` (multipart: `audio` + `config` JSON)

### Meeting Recording (Tab + Mic)
1. Side panel → `start-meeting-recording` → Background
2. Background: `chrome.tabCapture.getMediaStreamId({ targetTabId })` → streamId
3. Background creates offscreen, sends streamId + accessToken
4. Offscreen: tab audio via `getUserMedia({ audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId } } })`
5. Offscreen: mic via `getUserMedia({ audio: true })`
6. Web Audio mixer: two `MediaStreamSource` → `GainNode` each → `MediaStreamDestination`
7. Mixed stream → same PCM encoder → same WebSocket pipeline
8. Speaker diarization enabled in config

## WebSocket Protocol

| Step | Direction | Message |
|------|-----------|---------|
| Connect | Client → Server | `wss://proxy/api/v1/realtime?token=<accessToken>` |
| Config | Client → Server | `{ audio_format: "s16le", sample_rate: 16000, num_channels: 1, language_hints, enable_speaker_diarization }` |
| Ready | Server → Client | `{ type: "proxy_ready" }` |
| Audio | Client → Server | Binary PCM s16le frames (~100ms chunks) |
| Tokens | Server → Client | `{ tokens: [{ text, is_final, confidence, start_ms, end_ms, speaker? }] }` |
| Finalize | Client → Server | `{ type: "finalize" }` then empty binary frame |
| Done | Server → Client | `{ finished: true }` |

## MVP Implementation Phases

### MVP-1: Scaffold + Auth
- Init WXT project (TypeScript + React)
- Manifest with permissions
- `lib/api/client.ts` — fetch wrapper with Bearer header + 401 auto-refresh
- `lib/api/auth.ts` — sendOtp, verifyOtp, refresh (current proxy endpoints)
- `lib/auth/token-manager.ts` — chrome.storage.local + chrome.alarms (14 min refresh)
- Side panel: LoginScreen (email → OTP → logged in state)
- Background: `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`

### MVP-2: Voice Dictation (Async)
- Offscreen document: creation + lifecycle in background
- `lib/messaging/types.ts` — typed message union
- Offscreen: mic capture with `MediaRecorder` → WebM blob
- `lib/api/transcription.ts` — multipart POST to proxy
- Side panel: RecordingControls (record/stop button, state indicator)
- Side panel: TranscriptView (result text, copy button)
- **Test:** record voice → see transcript → copy to clipboard

### MVP-3: Voice Dictation (Real-time)
- `lib/audio/pcm-worklet.ts` — AudioWorkletProcessor (Float32 → Int16)
- `lib/audio/encoder.ts` — accumulate ~100ms PCM chunks
- `lib/realtime/ws-client.ts` — WebSocket matching proxy protocol exactly
- Offscreen: AudioContext(16kHz) → WorkletNode → WS stream
- Side panel: live token display (interim tokens gray, final black)
- Reconnection on drop (3 attempts)
- **Test:** record voice → see words appear live → final transcript

### MVP-4: Meeting Recording
- Background: `chrome.tabCapture.getMediaStreamId()` + Chrome 116+ check
- `lib/audio/mixer.ts` — Web Audio API tab+mic → single stream
- Side panel: separate "Meeting" button
- Speaker labels in transcript view
- **Test:** open YouTube/Meet → meeting record → hear tab audio in transcript

### MVP-5: MVP Polish
- Recording state in badge icon (color: green=recording, yellow=processing)
- Error handling: mic permission denied, tab capture unavailable, 402 usage limit
- Keepalive: empty binary every 25s during recording
- Basic settings in side panel: language hints toggle (uk/en)

## Technical Gotchas (MVP)
- `chrome.alarms` not `setInterval` (SW suspends)
- One offscreen document max — manage lifecycle
- `AudioContext(16kHz)` forces Chrome resample
- `chromeMediaSource: 'tab'` needs `as any` cast
- `chrome.tabCapture.getMediaStreamId` — Chrome 116+
- Buffer up to 100 audio frames before `proxy_ready`

## MVP Verification
- [ ] OTP login via current proxy
- [ ] Voice record (async) → transcript → copy
- [ ] Voice record (real-time) → live tokens → final text
- [ ] Meeting record (tab + mic) → mixed audio → transcript with speakers
- [ ] Token auto-refresh at 14 min
- [ ] Badge shows recording state
- [ ] Works on: YouTube, Google Meet (tab audio)

---

# PART 2: Full Version (Supabase + Features)

After MVP works, migrate to Supabase and add features. **Depends on:** `../PLAN-supabase.md`

## Auth Migration: Proxy OTP → Supabase Auth

```typescript
// Replace lib/api/auth.ts + lib/auth/token-manager.ts with:
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// Login
await supabase.auth.signInWithOtp({ email })
await supabase.auth.verifyOtp({ email, token: code, type: 'email' })

// Session auto-managed, auto-refresh — delete chrome.alarms token refresh
// WebSocket token: (await supabase.auth.getSession()).data.session.access_token
```

**Delete:** `lib/api/auth.ts`, `lib/auth/token-manager.ts`, chrome.alarms refresh logic
**Add:** `lib/supabase.ts` (client init)

## New Features

### Auto-Paste (Content Script)
- `entrypoints/content/auto-paste.ts`
- Inject via `chrome.scripting.executeScript()` after transcription
- Cascade: `execCommand('insertText')` → `InputEvent` → native setter → clipboard
- Settings toggle: "Auto-paste after transcription"
- Add `scripting` to manifest permissions

### Transcript History (Supabase DB)
- Save every transcript to `transcripts` table
- Side panel: TranscriptHistory component — scrollable list
- Full-text search across transcripts
- Shared with macOS Diduny app via Supabase

### Settings Sync (Supabase DB)
- Read/write `user_settings` table
- Supabase Realtime subscription for instant sync
- Side panel: Settings panel (language, diarization, auto-paste, auto-record)

### Audio Recording Storage (Supabase Storage)
- Optional: save audio to `audio-recordings` bucket
- Re-listen or re-transcribe later
- Toggle: "Save audio recordings"

### Meeting Detection
```typescript
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (/meet\.google\.com|zoom\.us\/wc|teams\.microsoft\.com.*meeting/.test(tab.url)) {
    chrome.action.setBadgeText({ text: '●', tabId })
    // Show notification: "You're in a meeting — record?"
  }
})
```

### Calendar Integration
- Google OAuth via `chrome.identity.launchWebAuthFlow` → Supabase
- Save provider tokens to `oauth_tokens` table
- Poll `calendar-events` Edge Function every 2 min
- Notification: "Standup in 3 min — auto-record?"
- Add `identity` to manifest permissions

### Analytics Events
```typescript
async function track(event: string, properties?: Record<string, any>) {
  await supabase.from('analytics_events').insert({
    user_id: (await supabase.auth.getUser()).data.user?.id,
    event, properties: properties ?? {}, source: 'chrome'
  })
}
```

### System Audio Capture (optional)
- `chrome.desktopCapture.chooseDesktopMedia(['screen', 'audio'])`
- Shows native picker — user must enable "Share system audio"
- Falls back to tab capture if unavailable
- Add `desktopCapture` to manifest permissions

## Part 2 Implementation Phases

### V2-1: Supabase Auth Migration
- Add `@supabase/supabase-js`
- Replace proxy OTP with Supabase OTP
- Remove manual token refresh (supabase-js handles it)
- Update WebSocket token source

### V2-2: Auto-Paste + Transcript History
- Content script with cascade insertion
- Transcript saving to Supabase DB
- TranscriptHistory component in side panel
- Search across transcripts

### V2-3: Settings Sync + Analytics
- Settings panel UI
- Supabase Realtime subscription for sync
- Analytics event tracking at key points

### V2-4: Meeting Detection + Calendar
- Tab URL monitoring for meeting providers
- Google Calendar OAuth flow
- Meeting reminders via Edge Function polling

### V2-5: Full Polish
- Audio recording storage (optional toggle)
- System audio capture (optional)
- Transcript export (text, SRT)
- Onboarding flow for new users

## Key Reference Files
- `diduny-ears-proxy/src/modules/realtime/infrastructure/outbound/soniox/soniox-realtime.adapter.ts` — WS protocol
- `Diduny/Diduny/Core/Services/CloudRealtimeService.swift` — reference client
- `Diduny/Diduny/Core/Models/RealtimeTranscription.swift` — token model
- `diduny-ears-proxy/src/modules/auth/infrastructure/inbound/http/auth.controller.ts` — current auth API
- `diduny-ears-proxy/openapi.yaml` — full API schema
