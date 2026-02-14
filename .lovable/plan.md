
# Create `realtime-token` Edge Function for OpenAI Realtime WebRTC

## Overview
Create a backend function that generates an ephemeral session token from the OpenAI Realtime API. The client will use this token to establish a direct WebRTC connection with OpenAI for speech-to-speech conversations.

## How it works

```text
Client (browser)
    |
    |  1. POST /realtime-token  { model, voice }
    v
Edge Function (server)
    |
    |  2. POST https://api.openai.com/v1/realtime/sessions
    |     Authorization: Bearer OPENAI_API_KEY
    v
OpenAI Realtime API
    |
    |  3. Returns { client_secret: { value: "eph_..." }, ... }
    v
Edge Function
    |
    |  4. Returns ephemeral token to client
    v
Client
    |
    |  5. Uses ephemeral token to connect via WebRTC directly to OpenAI
    v
OpenAI Realtime (WebRTC peer connection)
```

## Changes

### 1. Create `supabase/functions/realtime-token/index.ts`
- Reads `OPENAI_API_KEY` from server secrets
- Accepts optional `model` (default: `gpt-4o-mini-realtime-preview`) and `voice` (default: `alloy`) in request body
- Calls `POST https://api.openai.com/v1/realtime/sessions` with the API key
- Returns the full session response (including `client_secret.value`) to the client
- Includes CORS headers and error handling

### 2. Update `supabase/config.toml`
- Add `[functions.realtime-token]` with `verify_jwt = false`

## Technical Details

**Request:**
```json
POST /realtime-token
{
  "model": "gpt-4o-mini-realtime-preview",
  "voice": "alloy"
}
```

**Response (proxied from OpenAI):**
```json
{
  "id": "sess_...",
  "client_secret": {
    "value": "eph_...",
    "expires_at": 1234567890
  },
  ...
}
```

The client will then use `client_secret.value` as the ephemeral key to negotiate a WebRTC `RTCPeerConnection` with OpenAI's Realtime endpoint. No chat/completions involved -- this is purely for WebRTC session bootstrapping.
