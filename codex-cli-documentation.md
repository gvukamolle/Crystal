# OpenAI Codex CLI — Техническая документация

> Актуально на январь 2026. Источники: официальная документация OpenAI, GitHub репозиторий, DeepWiki.

## Обзор

**Codex CLI** — терминальный AI-агент от OpenAI для работы с кодом. Написан на Rust, распространяется через npm. Open source (Apache-2.0).

**Репозиторий:** https://github.com/openai/codex  
**Документация:** https://developers.openai.com/codex/  
**Текущая версия:** ~0.80.x (активная разработка)  
**Платформы:** macOS, Linux, Windows (experimental)

### Ключевые возможности

- Чтение, редактирование и выполнение кода в рабочей директории
- Интерактивный TUI и headless режим (exec)
- Web search интеграция
- Model Context Protocol (MCP) поддержка
- Sandbox режимы (Landlock/seccomp на Linux, seatbelt на macOS)
- Resume сессий

---

## Установка

```bash
# npm (основной способ)
npm install -g @openai/codex

# Homebrew (macOS)
brew install openai-codex

# Обновление
npm update -g @openai/codex
```

### Проверка установки

```bash
codex --version
# Вывод: codex-cli X.Y.Z
```

---

## Аутентификация

Codex поддерживает два метода аутентификации:

### 1. ChatGPT OAuth (рекомендуется)

Для пользователей ChatGPT Plus, Pro, Team, Edu, Enterprise.

```bash
codex login
```

**Процесс:**
1. CLI запускает локальный сервер на `localhost:1455`
2. Открывается браузер для авторизации
3. После успешной авторизации токены сохраняются локально
4. Refresh происходит автоматически каждые 8 дней

**Для headless серверов:**
```bash
# Device code flow
codex login --device-auth

# Или скопировать auth.json с машины с браузером
# Источник: ~/.codex/auth.json
```

### 2. API Key

Для CI/CD, автоматизации, pay-as-you-go биллинга.

```bash
# Из переменной окружения (рекомендуется)
printenv OPENAI_API_KEY | codex login --with-api-key

# Из файла
codex login --with-api-key < my_key.txt
```

### Хранение credentials

- **По умолчанию:** `~/.codex/auth.json` (permissions 600)
- **Альтернатива:** System keyring (настраивается через `cli_auth_credentials_store_mode`)

**Структура auth.json:**
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_at": "..."
}
```

### Проверка статуса

```bash
codex login status
# Exit code 0 = залогинен
```

### Logout

```bash
codex logout
```

---

## Режимы работы

### Интерактивный TUI

```bash
codex
# или с начальным промптом
codex "Explain this codebase"
```

### Non-interactive (exec)

Headless режим для скриптов и CI/CD.

```bash
codex exec "summarize the repo structure"
# Алиас:
codex e "summarize the repo structure"
```

---

## Non-interactive Mode (exec) — Детали

### Базовый синтаксис

```bash
codex exec [OPTIONS] "<prompt>"
codex exec [OPTIONS] resume [--last | <session_id>] ["<follow-up prompt>"]
```

### Ключевые флаги

| Флаг | Описание |
|------|----------|
| `--json` | Вывод в формате JSON Lines (JSONL) |
| `--full-auto` | workspace-write sandbox + auto approvals |
| `--sandbox <mode>` | read-only / workspace-write / danger-full-access |
| `--model <model>` | Выбор модели |
| `--cd <path>` | Рабочая директория |
| `--add-dir <path>` | Дополнительные директории для доступа |
| `--skip-git-repo-check` | Пропустить проверку Git репозитория |
| `-o, --output-last-message <path>` | Сохранить финальное сообщение в файл |
| `--output-schema <path>` | JSON Schema для структурированного вывода |
| `--search` | Включить web search |

### Примеры

```bash
# Простой запрос
codex exec "list all TODO comments"

# С JSON выводом для парсинга
codex exec --json "analyze dependencies" | jq

# Full auto режим (разрешает изменения)
codex exec --full-auto "fix the failing tests"

# Структурированный вывод
codex exec --output-schema schema.json -o result.json "extract metadata"

# Продолжение последней сессии
codex exec resume --last "now implement the plan"

# Продолжение конкретной сессии
codex exec resume 7f9f9a2e-1b3c-4c7a-9b0e-... "add error handling"
```

---

## JSON Output Format

При использовании `--json` Codex выводит **JSON Lines** (каждая строка — отдельный JSON объект).

### Типы событий

| Event Type | Описание |
|------------|----------|
| `thread.started` | Начало сессии, содержит `thread_id` |
| `turn.started` | Начало хода агента |
| `turn.completed` | Конец хода, содержит `usage` |
| `turn.failed` | Ход завершился с ошибкой |
| `item.started` | Начало действия (tool use) |
| `item.updated` | Прогресс действия |
| `item.completed` | Завершение действия |
| `error` | Ошибка |

### Типы item (tool uses)

| Type | Описание | Ключевые поля |
|------|----------|---------------|
| `agent_message` | Текстовое сообщение агента | `text`, `parsed` (при structured output) |
| `reasoning` | Reasoning/thinking процесс | `text`, `summary[]`, `content[]` |
| `command_execution` | Выполнение shell команды | `command`, `aggregated_output`, `exit_code`, `status` |
| `file_change` | Изменение файлов | `changes[]` (path, kind: add/delete/update) |
| `mcp_tool_call` | Вызов MCP инструмента | `server`, `tool`, `arguments`, `result`, `error` |
| `web_search` | Поиск в интернете | `query` |
| `todo_list` | Список задач агента | `items[]` (text, completed) |
| `error` | Ошибка (non-fatal) | `message` |

### Статусы item

| Status | Описание |
|--------|----------|
| `in_progress` | Выполняется |
| `completed` | Успешно завершено |
| `failed` | Завершено с ошибкой |
| `declined` | Отклонено (approval denied) |

### Примеры JSON событий

**thread.started:**
```json
{
  "type": "thread.started",
  "thread_id": "0199a213-81c0-7800-8aa1-bbab2a035a53"
}
```

**turn.started:**
```json
{
  "type": "turn.started"
}
```

**item.started (command_execution):**
```json
{
  "type": "item.started",
  "item": {
    "id": "item_1",
    "type": "command_execution",
    "command": "bash -lc ls",
    "status": "in_progress"
  }
}
```

**item.completed (command_execution):**
```json
{
  "type": "item.completed",
  "item": {
    "id": "item_1",
    "type": "command_execution",
    "command": "bash -lc ls -la",
    "aggregated_output": "total 24\ndrwxr-xr-x  5 user  staff  160 Jan 10 12:00 .\n...",
    "exit_code": 0,
    "status": "completed"
  }
}
```

**item.started (file_change):**
```json
{
  "type": "item.started",
  "item": {
    "id": "item_2",
    "type": "file_change",
    "changes": [
      {"path": "src/main.ts", "kind": "update"},
      {"path": "src/utils.ts", "kind": "add"}
    ],
    "status": "in_progress"
  }
}
```

**item.completed (file_change):**
```json
{
  "type": "item.completed",
  "item": {
    "id": "item_2",
    "type": "file_change",
    "changes": [
      {"path": "src/main.ts", "kind": "update"},
      {"path": "src/utils.ts", "kind": "add"}
    ],
    "status": "completed"
  }
}
```

**item.completed (agent_message):**
```json
{
  "type": "item.completed",
  "item": {
    "id": "item_3",
    "type": "agent_message",
    "text": "Here's what I found in the repository..."
  }
}
```

**item.completed (reasoning):**
```json
{
  "type": "item.completed",
  "item": {
    "id": "item_4",
    "type": "reasoning",
    "text": "To fix this issue, I need to first understand the error...",
    "summary": ["Understand the error", "Locate the code", "Apply fix"],
    "content": ["Raw reasoning chunk..."]
  }
}
```

**item.completed (mcp_tool_call):**
```json
{
  "type": "item.completed",
  "item": {
    "id": "item_5",
    "type": "mcp_tool_call",
    "server": "database_server",
    "tool": "query_records",
    "arguments": {"query": "SELECT * FROM users"},
    "result": {"content": [{"type": "text", "text": "3 rows returned"}]},
    "status": "completed"
  }
}
```

**item.completed (web_search):**
```json
{
  "type": "item.completed",
  "item": {
    "id": "item_6",
    "type": "web_search",
    "query": "TypeScript best practices 2025"
  }
}
```

**turn.completed:**
```json
{
  "type": "turn.completed",
  "usage": {
    "input_tokens": 24763,
    "cached_input_tokens": 24448,
    "output_tokens": 122
  }
}
```

**turn.failed:**
```json
{
  "type": "turn.failed",
  "error": {
    "message": "Rate limit exceeded"
  }
}
```

**error:**
```json
{
  "type": "error",
  "message": "Rate limit exceeded"
}
```

### Парсинг в shell

```bash
# Получить все текстовые сообщения
codex exec --json "task" | jq 'select(.type == "item.completed" and .item.type == "agent_message") | .item.text'

# Получить usage
codex exec --json "task" | jq 'select(.type == "turn.completed") | .usage'
```

---

## Sandbox режимы

| Режим | Описание | Флаг |
|-------|----------|------|
| `read-only` | Только чтение (default для exec) | — |
| `workspace-write` | Может изменять файлы в рабочей директории | `--full-auto` или `--sandbox workspace-write` |
| `danger-full-access` | Полный доступ + сеть | `--sandbox danger-full-access` |

**Важно:** В режиме `workspace-write` директории `.git/` и `.codex/` остаются read-only.

---

## Модели

### Актуальные модели (v0.80.0, январь 2026)

| Идентификатор | Описание | Default |
|---------------|----------|---------|
| `gpt-5.2-codex` | **Latest frontier agentic coding model.** Лучшая для сложных задач, cybersecurity | macOS, Linux |
| `gpt-5.1-codex-max` | Flagship для deep reasoning. Работает автономно часами, compaction через миллионы токенов | — |
| `gpt-5.1-codex-mini` | Cheaper, faster, less capable. Для простых и рутинных задач | — |
| `gpt-5.2` | Frontier model для knowledge, reasoning, coding. Универсальная | Windows |

### Legacy модели

| Идентификатор | Статус |
|---------------|--------|
| `gpt-5.1-codex` | Заменена на `gpt-5.2-codex` |
| `gpt-5-codex` | Устаревшая |
| `gpt-5-codex-mini` | Заменена на `gpt-5.1-codex-mini` |
| `gpt-5` | Заменена на `gpt-5.1` → `gpt-5.2` |

### Reasoning Effort Levels

Контролирует глубину "размышлений" модели. Чем выше — тем дольше думает, но качественнее результат:

| Уровень | CLI значение | Описание |
|---------|--------------|----------|
| Low | `low` | Fast responses with lighter reasoning |
| Medium | `medium` | **Default.** Balances speed and reasoning depth for everyday tasks |
| High | `high` | Greater reasoning depth for complex problems |
| Extra High | `xhigh` | Maximum reasoning. Для самых сложных задач (refactors, security) |

**Рекомендации OpenAI:**
- `medium` — daily driver для большинства задач
- `high` / `xhigh` — сложные refactors, multi-hour debugging, cybersecurity research

### Лимиты использования (на 5 часов)

| План | Local messages | Cloud tasks |
|------|----------------|-------------|
| ChatGPT Plus | 45-225 | 10-60 |
| ChatGPT Pro | 300-1,500 | 50-400 |

### Выбор модели и reasoning effort

```bash
# При запуске с конкретной моделью
codex -m gpt-5.2-codex "task"
codex exec --model gpt-5.1-codex-max "task"

# В интерактивном режиме — откроется picker
/model
```

### Конфигурация в config.toml

```toml
# Модель по умолчанию
model = "gpt-5.2-codex"

# Reasoning effort (опционально)
model_reasoning_effort = "medium"  # low, medium, high, xhigh
```

---

## Конфигурация

### Расположение файлов

```
~/.codex/
├── auth.json           # Credentials
├── config.toml         # Основная конфигурация
├── rules/              # Execpolicy rules
└── sessions/           # История сессий (JSONL)
    └── YYYY/MM/DD/
        └── rollout-*.jsonl
```

### config.toml — базовый пример

```toml
# Модель по умолчанию
model = "gpt-5.2-codex"

# Reasoning effort
model_reasoning_effort = "medium"  # low, medium, high, xhigh

# OSS провайдер для --oss режима
oss_provider = "ollama"

# Хранение credentials
cli_auth_credentials_store_mode = "file"  # или "keyring"

# Sandbox настройки
[sandbox]
default_mode = "workspace-write"

# Shell environment policy
[shell_environment_policy]
inherit = "core"
exclude = ["AWS_*", "AZURE_*"]
```

### Профили

```toml
[profiles.work]
model = "gpt-5.2-codex"
model_reasoning_effort = "high"

[profiles.fast]
model = "gpt-5.1-codex-mini"
model_reasoning_effort = "low"
```

Использование: `codex --profile work "task"`

---

## MCP (Model Context Protocol)

Codex поддерживает MCP для подключения внешних инструментов.

### Управление серверами

```bash
# Добавить stdio сервер
codex mcp add my-server -- /path/to/server

# Добавить HTTP сервер
codex mcp add my-http-server --url https://mcp.example.com/sse

# Список серверов
codex mcp list
codex mcp list --json

# Удалить
codex mcp remove my-server
```

### Конфигурация в config.toml

```toml
[mcp_servers.my-server]
command = ["/path/to/server"]
env = { API_KEY = "..." }
```

---

## TypeScript SDK

Для программного контроля Codex из Node.js приложений.

### Установка

```bash
npm install @openai/codex-sdk
```

### Использование

```typescript
import { Codex } from "@openai/codex-sdk";

const codex = new Codex();

// Новый thread
const thread = codex.startThread();
const result = await thread.run("Make a plan to fix CI failures");
console.log(result);

// Продолжение того же thread
const result2 = await thread.run("Implement the plan");

// Resume существующего thread
const existingThread = codex.resumeThread(threadId);
const result3 = await existingThread.run("Continue from where we left off");
```

**Требования:** Node.js 18+, server-side использование.

---

## GitHub Action

```yaml
- uses: openai/codex-action@v1
  with:
    prompt: "Review this PR"
    sandbox: read-only
    model: gpt-5.2-codex
  env:
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

---

## Сравнение с Claude Code CLI

| Аспект | Claude Code | Codex CLI |
|--------|-------------|-----------|
| Язык реализации | TypeScript | Rust |
| Лицензия | Proprietary | Apache-2.0 |
| Auth storage | macOS Keychain / Linux cred file | `~/.codex/auth.json` или keyring |
| OAuth callback port | — | localhost:1455 |
| Non-interactive | `--print --output-format stream-json` | `codex exec --json` |
| Event format | JSON Lines | JSON Lines |
| Resume флаг | `--resume <session_id>` | `resume --last` или `resume <thread_id>` |
| Subscription | Claude Pro/Max | ChatGPT Plus/Pro/Team/Enterprise |
| Официальный SDK | Нет | @openai/codex-sdk |
| Sandbox | Permissions в config | Landlock/seccomp/seatbelt |
| Git requirement | Нет | Да (можно отключить) |
| Default model (macOS/Linux) | claude-sonnet-4 | gpt-5.2-codex |
| Default model (Windows) | claude-sonnet-4 | gpt-5.2 |

---

## Особенности для интеграции в плагин

### 1. Запуск subprocess

```typescript
const args = ["exec", "--json"];

if (sandboxMode === "workspace-write") {
  args.push("--full-auto");
}

if (!isGitRepo) {
  args.push("--skip-git-repo-check");
}

args.push(prompt);

const proc = spawn("codex", args, {
  cwd: workingDir,
  stdio: ["pipe", "pipe", "pipe"]
});

proc.stdin.end(); // Важно!
```

### 2. Парсинг JSON Lines

```typescript
let buffer = "";

proc.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";
  
  for (const line of lines) {
    if (line.trim()) {
      const event = JSON.parse(line);
      handleEvent(event);
    }
  }
});
```

### 3. Resume сессий

```typescript
// Сохранить thread_id из thread.started события
// При resume:
const args = ["exec", "--json", "resume", "--last", followUpPrompt];
// или
const args = ["exec", "--json", "resume", threadId, followUpPrompt];
```

### 4. Обработка ошибок

- Проверять `type: "error"` в JSON
- Проверять `turn.failed` события
- Следить за exit code процесса

### 5. Детекция CLI

```typescript
function detectCodexPath(): string | null {
  const candidates = [
    "/usr/local/bin/codex",
    "/opt/homebrew/bin/codex",
    `${os.homedir()}/.cargo/bin/codex`,
    `${os.homedir()}/.local/bin/codex`
  ];
  
  for (const path of candidates) {
    if (fs.existsSync(path)) return path;
  }
  
  try {
    return execSync("which codex", { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}
```

---

## Известные ограничения

1. **Git repository** — по умолчанию требует Git репозиторий. Для Obsidian vault без git используй `--skip-git-repo-check`

2. **Windows** — экспериментальная поддержка

3. **Headless auth** — device code flow требует включения в настройках ChatGPT

4. **Rate limits** — зависят от подписки (Plus vs Pro vs Enterprise)

5. **Sandbox на Windows** — менее надёжный, рекомендуется `safety-strategy: unsafe` в GitHub Actions

---

## Полезные ссылки

- **Документация:** https://developers.openai.com/codex/
- **GitHub:** https://github.com/openai/codex
- **CLI Reference:** https://developers.openai.com/codex/cli/reference/
- **Non-interactive:** https://developers.openai.com/codex/noninteractive
- **Auth:** https://developers.openai.com/codex/auth
- **SDK:** https://developers.openai.com/codex/sdk/
- **Changelog:** https://developers.openai.com/codex/changelog/
