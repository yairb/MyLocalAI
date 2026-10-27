# My Local AI

A premium, ChatGPT-style desktop chat app for macOS that runs **entirely locally** using [llama.cpp](https://github.com/ggerganov/llama.cpp) and GGUF models.

Built with **Tauri 2**, **React**, **TypeScript**, **Vite**, **Tailwind CSS**, **Zustand**, and **SQLite**.

## Features

- Beautiful dark UI inspired by ChatGPT / Claude / Linear
- Streaming token-by-token responses via llama.cpp OpenAI-compatible API
- **AI image generation** with local Stable Diffusion (`.safetensors`)
- Prompt enhancement via MythoMax before generation
- Image cards in chat (download, regenerate, delete, fullscreen viewer)
- Multiple conversations with search (including image prompts), rename, delete
- **Characters** with a full persona, a generated face, memory, and photos (below)
- Settings for chat model, image model, sampling, resolution, seed
- SQLite persistence (conversations, messages, characters, memories, generated images)
- Native macOS window (overlay titlebar, keyboard shortcuts)

## Characters

A character is a person, not a system prompt: a backstory, traits, a voice, a
relationship with you, and a face that stays the same in every picture.

- **Character Studio** — backstory, personality, speaking style, reply length, voice
  samples, relationship and scene, limits. A live preview shows exactly what the model
  will be given.
- **A generated profile picture.** Describe how they look; the picture is made with
  your local Stable Diffusion model and the seed is locked, so later photos show the
  same face. Re-roll if you want a different one.
- **Memory.** A rolling summary keeps the thread of a long conversation, and durable
  facts about you are remembered across conversations. Both are visible and editable
  under Memory in the Studio — pin what matters, delete what's wrong.
- **Replies that read as scenes.** Narration is a per-character setting. On *Story* —
  the default — speech goes in quotes and everything else is narrated in asterisks:
  `"That's fine." *Kate pushed herself up onto her feet, not quite meeting his eye.*`
  The character is told to move the scene along rather than wait to be prompted, so a
  long conversation turns into a story instead of call-and-response. *With actions* and
  *Dialogue only* are there for characters that shouldn't do that.
- **Pictures on request.** Ask with the wand button and the picture is of the
  character, using their appearance and locked seed. Characters do *not* decide to send
  pictures on their own: generating one stops llama-server to free the GPU and reloads
  it afterwards, which mid-reply reads as the app hanging.
- **Per conversation.** Each chat remembers whose it is; switch with the name in the
  header.
- **Group chats.** Add more characters to a conversation from the same menu. Each one
  keeps its own persona, voice and memory, sees the others as people rather than as
  itself, and answers only for itself. Address someone by name and they reply;
  otherwise whoever has been quiet longest speaks, never twice in a row. Settings →
  Characters sets how many of them answer a single message.
- **Written with the model.** Every text field in the Studio has a button that writes
  it from the rest of the sheet, or sharpens what's already there. The chat box has one
  too, for your own side of the conversation — it fills the composer so you can edit
  before sending, never sends for you.

The original prompt-only assistants (Default Assistant, Coding Expert, Creative
Writer) keep working exactly as before — they simply use their own system prompt.

Long conversations are also now budgeted against the model's real context window,
which it reads from the running server. Before this, a chat that outgrew the window
failed outright: `llama-server` ships with context shifting disabled.

### Shortcuts

| Shortcut | Action        |
| -------- | ------------- |
| ⌘ N      | New chat      |
| ⌘ K      | Search chats  |
| ⌘ ,      | Settings      |

## Requirements

- macOS 12+ (Apple Silicon recommended)
- Node.js 20+
- Rust (stable)
- [llama.cpp](https://github.com/ggerganov/llama.cpp) with `llama-server` on your PATH

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install llama.cpp (Metal-enabled on Apple Silicon)
brew install llama.cpp
```

## Model setup (M1/M2/M3 16GB)

Models are **not** bundled in the app.

### Chat (GGUF / llama.cpp)

```text
~/Library/Application Support/MyLocalAI/models/
```

Recommended starter (fits ~16GB with room for the OS):

- **MythoMax-L2-13B** — `Q4_K_M` quant (~7–8GB)

```bash
mkdir -p "$HOME/Library/Application Support/MyLocalAI/models"
# Download your GGUF into that folder, then select it in Settings → Model
```

### Images (Stable Diffusion / stable-diffusion.cpp)

```text
~/Library/Application Support/MyLocalAI/models/image/
```

Example SD 1.5 checkpoint:

```bash
mkdir -p "$HOME/Library/Application Support/MyLocalAI/models/image"
# Place stable-diffusion-v1-5.safetensors there, then select it in Settings → Images
```

Install the `sd` binary from [stable-diffusion.cpp](https://github.com/leejet/stable-diffusion.cpp) and ensure it is on your `PATH` (or set the path in Settings → Images).

In chat, click the **wand** button next to the input to enter image mode, describe what you want, and send.

## Development

```bash
cd MyLocalAI
npm install

# Frontend only (uses localStorage + external llama-server if running)
npm run dev

# Full desktop app
npm run tauri:dev
```

### Manual llama-server (optional)

If you prefer to run the server yourself:

```bash
llama-server \
  --model "$HOME/Library/Application Support/MyLocalAI/models/mythomax-l2-13b.Q4_K_M.gguf" \
  --ctx-size 4096 \
  --host 127.0.0.1 \
  --port 8080 \
  --n-gpu-layers 99
```

The app will detect a healthy server on `http://127.0.0.1:8080`.

## Production build

```bash
npm run tauri:build
```

The `.app` bundle is written under:

```text
src-tauri/target/release/bundle/macos/My Local AI.app
```

## Project structure

```text
src/
  components/   Chat, Sidebar, Settings, UI
  hooks/        Keyboard shortcuts
  stores/       Zustand (chat, characters, settings, engine)
  services/     llamaClient, database (Tauri IPC + browser fallback)
  types/
  utils/
src-tauri/
  src/          Rust: SQLite, llama-server process, commands
```

## Architecture notes

### Inference

Frontend streams from:

```http
POST http://127.0.0.1:8080/v1/chat/completions
```

with `stream: true` and an SSE body. The Tauri backend only manages the **process** and **settings**, not the token stream (keeps latency low).

### Data

SQLite tables: `conversations`, `messages`, `characters`, `settings`, `generated_images`, and a future-ready `memories` table.

### Image generation

Frontend uses `ImageGenerationProvider` (`src/services/imageGeneration.ts`). The Stable Diffusion backend runs in Rust (`src-tauri/src/image_gen.rs`) by spawning `sd` (stable-diffusion.cpp) or the MLX script. Every image — the chat tool, a character selfie, an avatar — goes through `src/services/imagePipeline.ts`, which composes the prompt while the chat engine is still up, then stops it for the duration of the generation and waits for it to reload afterwards.

### Characters

`src/services/personaPrompt.ts` compiles a character into a system prompt. It is pure,
which is what makes the live preview in the Studio possible. A character with no
persona fields, or with the override flag set, falls back to its raw `system_prompt`
unchanged — that is how the original assistants keep working.

`src/services/contextBudget.ts` packs the conversation into the window: persona first,
then a capped memory block, then as many recent turns as fit, walking backwards. The
token estimator is calibrated once per model load against the server's `/tokenize`.

`src/services/memory/` runs after a reply is on screen, never before: it folds older
turns into a rolling summary and extracts durable facts, both guarded by an in-flight
lock and an optimistic version so a slow background run can never clobber a newer one.

`src/services/groupChat.ts` decides who speaks next and rewrites the transcript from
that character's point of view: their own turns are the assistant's, the user and the
other characters arrive labelled. Runs of incoming turns are folded into one message,
since some chat templates assume strict alternation. Speaker choice is a heuristic —
name mention, then least-recently-spoken — rather than a director call to the model,
which would cost a whole prompt evaluation before any of the reply.

`src/services/characterWriter.ts` writes or rewrites one field of a character sheet,
always in the context of the fields already filled in.

`src/services/replyWriter.ts` drafts the user's own next line, matching the narration
style of whoever spoke last.

`src/services/imageDirector.ts` composes character-consistent image prompts. It also
strips a stray `[IMG: ...]` sentinel from a reply — characters no longer decide to send
pictures, but a model trained on that pattern may still emit one, and stripping it beats
showing the user raw brackets.

## License

MIT
