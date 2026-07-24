# My Local AI

A premium, ChatGPT-style desktop chat app for macOS that runs **entirely locally** using [llama.cpp](https://github.com/ggerganov/llama.cpp) and GGUF models.

Built with **Tauri 2**, **React**, **TypeScript**, **Vite**, **Tailwind CSS**, **Zustand**, and **SQLite**.

## Features

- Beautiful dark UI inspired by ChatGPT / Claude / Linear
- Streaming token-by-token responses via llama.cpp OpenAI-compatible API
- Multiple conversations with search, rename, delete
- AI **Characters** (system prompts + per-character temperature)
- Settings for model path, context size, Metal GPU layers, sampling
- SQLite persistence (conversations, messages, characters)
- Architecture ready for long-term memory
- Native macOS window (overlay titlebar, keyboard shortcuts)

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

Models are **not** bundled in the app. Place GGUF files here:

```text
~/Library/Application Support/MyLocalAI/models/
```

Recommended starter (fits ~16GB with room for the OS):

- **MythoMax-L2-13B** — `Q4_K_M` quant (~7–8GB)

Example:

```bash
mkdir -p "$HOME/Library/Application Support/MyLocalAI/models"
# Download your GGUF into that folder, then select it in Settings → Model
```

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

SQLite tables: `conversations`, `messages`, `characters`, `settings`, and a future-ready `memories` table.

### Characters

Each chat injects the active character’s `system_prompt` as the first message. Character temperature overrides global temperature when set.

## License

MIT
