# Cristal - Multi-Agent Obsidian Plugin

## Обзор проекта

Плагин для Obsidian, интегрирующий несколько AI провайдеров через CLI:
- **Claude AI** (Anthropic) через Claude Code CLI
- **Codex** (OpenAI) через Codex CLI
- Расширяемая архитектура для добавления новых агентов (Gemini, Grok и другие)

Использует существующие подписки через OAuth аутентификацию CLI.

### Цель
Нативная multi-agent система в Obsidian с:
- Полным доступом к vault
- Гибкими разрешениями (для Claude)
- Встроенным терминалом для управления CLI
- Статистикой использования с визуальными лимитами

### Ключевое ограничение
Anthropic и OpenAI **официально не разрешают** third-party приложениям использовать OAuth подписку напрямую:
> "Unless previously approved, we do not allow third party developers to offer Claude.ai login or rate limits for their products"

**Решение:** Плагин работает как wrapper над локально установленными CLI — пользователь сам авторизуется в CLI, и плагин использует их как subprocess. Это легальный способ интеграции, так как CLI принадлежат самим провайдерам.

---

## Архитектура

### High-level flow

```
┌──────────────────────────────────────────────────────────────┐
│                      Obsidian Plugin                         │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   ChatView   │  │TerminalView  │  │   Settings   │     │
│  │              │  │              │  │              │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
│         │                  │                  │              │
│  ┌──────▼──────────────────▼──────────────────▼───────┐    │
│  │            CristalPlugin (main.ts)                  │    │
│  │  - settings.agents (AgentConfig[])                  │    │
│  │  - settings.defaultAgentId                          │    │
│  │  - ChatView переключает между сервисами             │    │
│  └──────┬───────────────────┬──────────────────────────┘    │
│         │                   │                                │
│  ┌──────▼──────┐     ┌──────▼──────┐                       │
│  │ClaudeService│     │CodexService │                       │
│  │- spawn CLI  │     │- spawn CLI  │                       │
│  │- stream-json│     │- json events│                       │
│  │- sessions   │     │- threads    │                       │
│  └──────┬──────┘     └──────┬──────┘                       │
│         │                   │                                │
│  ┌──────▼───────────────────▼──────┐                       │
│  │     UsageLimitsService           │                       │
│  │  - fetchClaudeUsage() (API)      │                       │
│  │  - fetchCodexUsage() (sessions)  │                       │
│  └──────────────────────────────────┘                       │
└─────────┼───────────────────┼────────────────────────────────┘
          │                   │
    ┌─────▼──────┐     ┌─────▼──────┐
    │Claude CLI  │     │Codex CLI   │
    │(subprocess)│     │(subprocess)│
    └─────┬──────┘     └─────┬──────┘
          │                   │
    ┌─────▼──────┐     ┌─────▼──────┐
    │Anthropic   │     │OpenAI      │
    │API (OAuth) │     │API (OAuth) │
    └────────────┘     └────────────┘
```

### Структура проекта

```
cristal/
├── src/
│   ├── main.ts                    # Plugin entry (CristalPlugin class)
│   ├── ClaudeService.ts           # Claude Code CLI wrapper
│   ├── CodexService.ts            # Codex CLI wrapper
│   ├── ChatView.ts                # Chat UI (ItemView)
│   ├── UsageLimitsService.ts      # Token tracking & API limits
│   ├── cliDetector.ts             # CLI auto-detection (which/where)
│   ├── codexConfig.ts             # Codex config.toml manager
│   ├── settings.ts                # Settings UI & persistence
│   ├── systemPrompts.ts           # AI instructions (8 languages)
│   ├── types.ts                   # TypeScript types & interfaces
│   └── terminal/
│       ├── TerminalView.ts        # Terminal UI (ItemView)
│       ├── TerminalService.ts     # Terminal session management
│       ├── XtermWrapper.ts        # xterm.js wrapper
│       └── types.ts               # Terminal types (IPtyBackend, etc.)
├── styles.css
├── manifest.json
├── package.json
└── tsconfig.json
```

**Ключевые отличия от типичного Obsidian плагина:**
- Нет отдельного AgentManager.ts (управление через settings.agents в main.ts)
- Терминал в отдельной папке terminal/
- UsageLimitsService работает с обоими CLI разными способами (API vs session parsing)

---

## Claude Code CLI

### Установка (prerequisite для пользователя)

```bash
npm install -g @anthropic-ai/claude-code
```

### Аутентификация

Пользователь должен залогиниться один раз:
```bash
claude
# Откроется браузер для OAuth
```

### Хранение credentials

| Platform | Location |
|----------|----------|
| macOS | Encrypted Keychain, service: `Claude Code-credentials` |
| Linux | `~/.claude/.credentials.json` |
| Windows | Windows Credential Manager (предположительно) |

### Формат credentials (Linux)

```json
{
  "claudeAiOauth": {
    "accessToken": "sk-ant-oat01-...",
    "refreshToken": "sk-ant-ort01-...",
    "expiresAt": 1748658860401,
    "scopes": ["user:inference", "user:profile"]
  }
}
```

---

## CLI Headless Mode

### Базовая команда

```bash
claude -p "твой промпт" --output-format stream-json
```

### Ключевые флаги

| Flag | Description |
|------|-------------|
| `-p, --print` | Non-interactive mode, print result |
| `--output-format text\|json\|stream-json` | Формат вывода |
| `--resume <session_id>` | Продолжить сессию |
| `--continue, -c` | Продолжить последнюю сессию |
| `--append-system-prompt` | Добавить к system prompt |
| `--allowedTools` | Список разрешённых tools |
| `--disallowedTools` | Список запрещённых tools |
| `--verbose` | Verbose logging |

### Output форматы

#### `--output-format text` (default)
Просто текст ответа.

#### `--output-format json`
Один JSON объект с результатом:
```json
{
  "type": "result",
  "subtype": "success",
  "total_cost_usd": 0.003,
  "is_error": false,
  "duration_ms": 1234,
  "duration_api_ms": 800,
  "num_turns": 6,
  "result": "The response text here...",
  "session_id": "abc123"
}
```

#### `--output-format stream-json` (рекомендуется)
JSONL — каждая строка отдельный JSON объект:

```jsonl
{"type":"system","subtype":"init","session_id":"550e8400-e29b-41d4-a716-446655440000","tools":["Read","Write","Bash",...]}
{"type":"user","message":{"role":"user","content":[{"type":"text","text":"Hello"}]}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hi! How can I help?"}]},"session_id":"..."}
{"type":"result","subtype":"success","result":"Hi! How can I help?","session_id":"...","total_cost_usd":0.001,"duration_ms":1500}
```

---

## Message Types

### System Messages

```typescript
// Init message (первое сообщение)
interface InitMessage {
  type: "system";
  subtype: "init";
  session_id: string;
  tools: string[];
  mcp_servers: Record<string, unknown>;
}

// Result message (последнее сообщение)
interface ResultMessage {
  type: "result";
  subtype: "success" | "error";
  result: string;
  session_id: string;
  is_error: boolean;
  total_cost_usd: number;
  duration_ms: number;
  duration_api_ms: number;
  num_turns: number;
}
```

### User/Assistant Messages

```typescript
interface ConversationMessage {
  type: "user" | "assistant";
  message: {
    role: "user" | "assistant";
    content: ContentBlock[];
  };
  session_id: string;
  uuid?: string;
}

type ContentBlock = 
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };
```

### Streaming Events

При `stream-json` также приходят partial events:
```typescript
interface StreamEvent {
  type: "stream_event";
  event: RawMessageStreamEvent; // from Anthropic SDK
  parent_tool_use_id: string | null;
  uuid: string;
  session_id: string;
}
```

---

## Multi-turn Conversations

### Продолжение по session_id

```bash
# Первый запрос — получаем session_id
claude -p "Analyze my vault structure" --output-format json
# Response: {"session_id": "abc-123", "result": "..."}

# Продолжение
claude -p "Now summarize the findings" --resume abc-123 --output-format json
```

### Продолжение последней сессии

```bash
claude -p "Continue where we left off" --continue --output-format json
```

---

## Implementation Notes

### Spawn process (Node.js)

```typescript
import { spawn } from 'child_process';

function query(prompt: string, sessionId?: string): AsyncGenerator<Message> {
  const args = ['-p', prompt, '--output-format', 'stream-json'];
  
  if (sessionId) {
    args.push('--resume', sessionId);
  }
  
  const proc = spawn('claude', args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env }
  });
  
  // Parse JSONL from stdout
  // ...
}
```

### JSONL Parser

```typescript
function parseJSONL(chunk: string): Message[] {
  return chunk
    .split('\n')
    .filter(line => line.trim())
    .map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}
```

### Obsidian ItemView

```typescript
import { ItemView, WorkspaceLeaf } from 'obsidian';

export const CLAUDE_VIEW_TYPE = 'claude-chat-view';

export class ClaudeChatView extends ItemView {
  getViewType(): string {
    return CLAUDE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return 'Claude Chat';
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1];
    container.empty();
    container.createEl('div', { cls: 'claude-chat-container' });
    // Build UI...
  }
}
```

---

## Codex CLI

### Установка
```bash
npm install -g @openai/codex-cli
```

### Аутентификация
OAuth flow через `codex` команду — откроется браузер для авторизации.

### Хранение credentials
- Config: `~/.codex/config.toml`
- Sessions: `~/.codex/sessions/` (JSONL файлы с историей)

### Headless Mode
```bash
codex exec --json --skip-git-repo-check \
  --sandbox danger-full-access \
  --reasoning-level medium \
  --message "your prompt"
```

### Output Format — JSON Events
```json
{"event": "thread.started", "thread_id": "..."}
{"event": "turn.started"}
{"event": "item.started", "type": "agent_message"}
{"event": "item.updated", "delta": {"text": "..."}}
{"event": "item.completed"}
{"event": "turn.completed", "usage": {...}}
```

### Item Types
- `agent_message` — AI response
- `reasoning` — deep reasoning output
- `command_execution` — bash commands
- `file_read` / `file_write` / `file_change`
- `mcp_tool_call`
- `web_search`
- `todo_list`
- `error`

---

## Multi-Agent Architecture

### AgentConfig
```typescript
interface AgentConfig {
  id: string;                      // Unique ID
  cliType: "claude" | "codex";     // CLI type
  name: string;                    // Display name
  description: string;             // Agent description
  enabled: boolean;                // Active/inactive
  cliPath: string;                 // Path to CLI binary
  model: string;                   // Default model

  // Claude-specific
  thinkingEnabled?: boolean;       // Extended thinking
  permissions?: {
    webSearch: boolean;
    webFetch: boolean;
    task: boolean;
  };

  // Codex-specific
  reasoningEnabled?: boolean;      // false=medium, true=xhigh
}
```

### Default Agents (types.ts:234)
1. **Claude** (id: "claude-default")
   - enabled: true
   - model: claude-haiku-4-5-20251001
   - thinkingEnabled: false
   - permissions: { webSearch: false, webFetch: false, task: false }

2. **Codex** (id: "codex-default")
   - enabled: false
   - model: gpt-5.2-codex
   - reasoningEnabled: false (= medium)

### CLI Auto-Detection (cliDetector.ts)
- `which` / `where` команды
- Platform-specific paths:
  - macOS: `/usr/local/bin`, `/opt/homebrew/bin`, `~/.npm/bin`
  - Linux: `/usr/local/bin`, `/usr/bin`, `~/.npm/bin`
  - Windows: `%APPDATA%/npm`, `C:\Program Files\nodejs`
- NVM support — рекурсивный поиск в `~/.nvm/versions/node/*/bin`

---

## Terminal Integration

### Компоненты
- `terminal/TerminalView.ts` — Obsidian ItemView с xterm.js
- `terminal/TerminalService.ts` — управление сессиями
- `terminal/XtermWrapper.ts` — обертка над xterm.js
- `terminal/types.ts` — IPtyBackend, TerminalSession

### Возможности
- Установка CLI через встроенный терминал
- OAuth авторизация прямо в плагине
- Настройки: fontSize, fontFamily, scrollback, cursorStyle
- Restart и Close через UI

---

## Usage Tracking

### UsageLimitsService

#### Claude Usage (API)
Источник: `https://api.anthropic.com/api/oauth/usage`

Получение токена:
- macOS: Keychain — `security find-generic-password -s "Claude Code-credentials" -w`
- Linux: `~/.claude/.credentials.json`

Response:
```typescript
interface ClaudeUsageLimits {
  fiveHour: { utilization: number; resetsAt: string | null };
  sevenDay: { utilization: number; resetsAt: string | null };
  sevenDayOpus?: { utilization: number; resetsAt: string | null };
  sevenDaySonnet?: { utilization: number; resetsAt: string | null };
}
```

#### Codex Usage (Session Parsing)
Источник: `~/.codex/sessions/` — парсинг `token_count` events

Формат:
```json
{"type": "event_msg", "payload": {"type": "token_count", "rate_limits": {
  "primary": {"used_percent": 0.42, "resets_at": 1736780400},
  "secondary": {"used_percent": 0.15, "resets_at": 1737385200}
}}}
```

Маппинг: `primary` → 5-hour, `secondary` → 7-day

---

## Known Issues & Limitations

### CLI Issues (из GitHub issues)

1. **Large stdin bug** — CLI может возвращать пустой output при большом input (>7000 chars)
2. **Windows subprocess** — Проблемы с stdin/stdout buffering в Windows
3. **Token expiry** — Refresh tokens eventually expire, требуют re-login
4. **Model restrictions** — Pro подписка не имеет доступа к Opus, только Sonnet

### Credential Errors

```
"This credential is only authorized for use with Claude Code and cannot be used for other API requests."
```
Эта ошибка возникает при попытке использовать OAuth token напрямую с API. Наш подход (через CLI) обходит эту проблему.

### Rate Limits

Claude Pro/Max имеет rate limits на количество сообщений. При превышении CLI вернёт соответствующую ошибку.

---

## Development Setup

### Prerequisites
- Node.js 18+
- Claude CLI и/или Codex CLI (для тестирования)
- Obsidian desktop app

### Installation
```bash
git clone <repo>
cd cristal
npm install
```

### Development
```bash
npm run dev  # Watch mode compilation
```

### Testing
1. Symlink plugin to Obsidian vault:
   ```bash
   ln -s $(pwd) /path/to/vault/.obsidian/plugins/cristal
   ```
2. Reload Obsidian (Cmd/Ctrl+R)
3. Enable plugin in Settings → Community Plugins
4. Убедитесь, что хотя бы один CLI установлен и авторизован

### Building
```bash
npm run build  # Production build
```

### Debugging
- Chrome DevTools: View → Toggle Developer Tools
- Console logs с префиксом `[Cristal]`
- Terminal logs для CLI output
- Используйте встроенный терминал плагина для отладки CLI

---

## Resources

### Obsidian
- [Obsidian Plugin Sample](https://github.com/obsidianmd/obsidian-sample-plugin)
- [Obsidian API Docs](https://docs.obsidian.md/Plugins/Getting+started/Build+a+plugin)

### Claude
- [Claude Code Docs - Headless Mode](https://code.claude.com/docs/en/headless)
- [Claude Agent SDK TypeScript](https://github.com/anthropics/claude-agent-sdk-typescript)
- [Claude Code CLI Reference](https://code.claude.com/docs/en/cli-reference)
- [Anthropic API Docs](https://docs.anthropic.com)

### Codex
- [OpenAI Codex CLI Docs](https://platform.openai.com/docs/guides/codex)
- [OpenAI API Reference](https://platform.openai.com/docs/api-reference)

### Libraries
- [xterm.js](https://xtermjs.org/) — Terminal emulator
- [node-pty](https://github.com/microsoft/node-pty) — Pseudoterminal bindings

---

## Legal Note

Этот плагин использует CLI инструменты как subprocess. Пользователь самостоятельно:
- Устанавливает Claude Code CLI и/или Codex CLI
- Проходит аутентификацию через официальные OAuth flows
- Несёт ответственность за соблюдение Terms of Service провайдеров (Anthropic, OpenAI)

Плагин не хранит и не передаёт credentials пользователя. Все токены управляются CLI инструментами.
