# Codex CLI Integration Plan

## Контекст проекта

Obsidian плагин "Claude Rock" интегрирует Claude Code CLI для AI-ассистента в Obsidian. Нужно добавить поддержку OpenAI Codex CLI как альтернативного провайдера в том же интерфейсе.

## Текущая архитектура

### Ключевые файлы
- `ClaudeService.ts` — сервис общения с Claude CLI через subprocess
- `ChatView.ts` — UI чата в sidebar Obsidian  
- `types.ts` — типы для CLI сообщений и UI состояния
- `cliDetector.ts` — автодетект пути к CLI
- `settings.ts` — страница настроек плагина
- `main.ts` — точка входа плагина

### Как работает ClaudeService
1. `spawn("claude", ["-p", prompt, "--output-format", "stream-json", "--verbose"])`
2. `stdin.end()` сразу после spawn
3. Парсит JSON Lines из stdout
4. Эмитит события: streaming, toolUse, assistant, result, error, init, complete, contextUpdate
5. Поддерживает `--resume <sessionId>` для продолжения сессий
6. Хранит Map<sessionId, ChildProcess> для параллельных сессий

---

## Задача 1: Создать CodexService.ts

Создать файл `src/CodexService.ts` по образцу ClaudeService.

### Команда запуска Codex CLI
```bash
codex exec --json "<prompt>"
```

### Для resume сессии
```bash
codex exec resume --last "<prompt>"
# Или продолжить конкретный thread_id (рекомендуется для плагина)
codex exec resume <thread_id> "<prompt>"
```

### JSON события Codex (формат JSON Lines)

```typescript
// thread.started — начало сессии
{ "type": "thread.started", "thread_id": "uuid" }

// turn.started — начало хода
{ "type": "turn.started" }

// item.started — начало действия (tool use)
{ 
  "type": "item.started", 
  "item": { 
    "id": "item_1", 
    "type": "command_execution", // или "file_read", "file_write"
    "command": "bash -lc ls",
    "status": "in_progress" 
  }
}

// item.updated — прогресс (опционально)
{ "type": "item.updated", "item": {...} }

// item.completed — завершение действия
{ 
  "type": "item.completed", 
  "item": { 
    "id": "item_3", 
    "type": "agent_message", 
    "text": "Here's what I found..." 
  }
}

// turn.completed — конец хода с usage
{ 
  "type": "turn.completed", 
  "usage": { 
    "input_tokens": 24763, 
    "cached_input_tokens": 24448, 
    "output_tokens": 122 
  }
}

// error
{ "type": "error", "message": "..." }
```

### Маппинг событий Codex → внутренние события плагина

| Codex event | Emit event | Данные |
|-------------|------------|--------|
| `thread.started` | `init` | `{ sessionId, cliSessionId: thread_id }` |
| `item.started` (command_execution) | `toolUse` | `{ sessionId, tool: ToolUseBlock }` |
| `item.completed` (agent_message) | `streaming` | `{ sessionId, text }` |
| `turn.completed` | `result` + `contextUpdate` | usage данные |
| `error` | `error` | `{ sessionId, error: message }` |

### Шаблон CodexService.ts

```typescript
import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { ToolUseBlock, PendingMessage } from "./types";

// Codex CLI event types
interface CodexThreadStarted {
  type: "thread.started";
  thread_id: string;
}

interface CodexTurnStarted {
  type: "turn.started";
}

interface CodexItem {
  id: string;
  type: "command_execution" | "file_read" | "file_write" | "agent_message";
  command?: string;
  text?: string;
  status?: string;
}

interface CodexItemEvent {
  type: "item.started" | "item.updated" | "item.completed";
  item: CodexItem;
}

interface CodexTurnCompleted {
  type: "turn.completed";
  usage: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
  };
}

interface CodexError {
  type: "error";
  message: string;
}

type CodexEvent = CodexThreadStarted | CodexTurnStarted | CodexItemEvent | CodexTurnCompleted | CodexError;

export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export class CodexService extends EventEmitter {
  private processes: Map<string, ChildProcess> = new Map();
  private threadIds: Map<string, string> = new Map();
  private pendingMessages: Map<string, PendingMessage> = new Map();
  private cliPath: string;
  private workingDir: string;
  private sandboxMode: CodexSandboxMode = "read-only";
  private debug = true;

  constructor(cliPath: string = "codex", workingDir: string = process.cwd()) {
    super();
    this.cliPath = cliPath;
    this.workingDir = workingDir;
  }

  private log(...args: unknown[]): void {
    if (this.debug) {
      console.log("[CodexService]", ...args);
    }
  }

  setCliPath(path: string): void {
    this.cliPath = path;
  }

  setWorkingDir(dir: string): void {
    this.workingDir = dir;
  }

  setSandboxMode(mode: CodexSandboxMode): void {
    this.sandboxMode = mode;
  }

	  async sendMessage(prompt: string, sessionId: string, threadId?: string, model?: string): Promise<void> {
    // Abort existing process for this sessionId
    const existingProcess = this.processes.get(sessionId);
    if (existingProcess) {
      this.log(`Aborting existing process for session ${sessionId}`);
      this.abort(sessionId);
    }

    this.pendingMessages.set(sessionId, { text: "", tools: [] });

	    // Build args
	    const args = ["exec", "--json"];
    
    // Sandbox mode
    if (this.sandboxMode === "workspace-write") {
      args.push("--full-auto");
    } else if (this.sandboxMode === "danger-full-access") {
      args.push("--sandbox", "danger-full-access");
    }
	    // read-only is default, no flag needed
	
	    // Codex по умолчанию ожидает git repo; для vault без git добавляем флаг
	    if (!fs.existsSync(path.join(this.workingDir, ".git"))) {
	      args.push("--skip-git-repo-check");
	    }

    if (model) {
      args.push("--model", model);
    }

	    // Resume or new prompt
	    if (threadId) {
	      args.push("resume", threadId, prompt);
	    } else {
	      args.push(prompt);
	    }

    this.log("Spawning:", this.cliPath, args, "for sessionId:", sessionId);

    const pathAdditions = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];
    const homeDir = process.env.HOME || os.homedir();
    const env = {
      ...process.env,
      PATH: pathAdditions.join(":") + ":" + (process.env.PATH || ""),
      HOME: homeDir,
      USER: process.env.USER || os.userInfo().username
    };

    const childProcess = spawn(this.cliPath, args, {
      cwd: this.workingDir,
      env,
      stdio: ["pipe", "pipe", "pipe"]
    });

    this.processes.set(sessionId, childProcess);
    childProcess.stdin?.end();

    this.log("Process spawned, PID:", childProcess.pid);

    let buffer = "";
    let accumulatedText = "";

    childProcess.stdout?.on("data", (chunk: Buffer) => {
      const chunkStr = chunk.toString();
      this.log("stdout chunk:", chunkStr.length, "bytes");
      buffer += chunkStr;

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          const result = this.parseLine(line, sessionId);
          if (result?.type === "text") {
            accumulatedText = result.text;
            const pending = this.pendingMessages.get(sessionId);
            if (pending) {
              pending.text = accumulatedText;
            }
            this.emit("streaming", { sessionId, text: accumulatedText });
          }
        }
      }
    });

    childProcess.stderr?.on("data", (data: Buffer) => {
      const errorText = data.toString();
      this.log("stderr:", errorText);
      // Codex пишет прогресс в stderr, не всё — ошибки
    });

    childProcess.on("error", (err: Error) => {
      this.log("Process error:", err.message);
      this.emit("error", { sessionId, error: `Failed to start Codex CLI: ${err.message}` });
      this.processes.delete(sessionId);
    });

    childProcess.on("close", (code: number | null) => {
      this.log("Process closed with code:", code);
      if (buffer.trim()) {
        this.parseLine(buffer, sessionId);
      }
      this.emit("complete", { sessionId, code });
      this.processes.delete(sessionId);
    });
  }

  private parseLine(line: string, sessionId: string): { type: "text"; text: string } | null {
    this.log("Parsing:", line.substring(0, 100) + "...");
    try {
      const event = JSON.parse(line) as CodexEvent;
      return this.handleEvent(event, sessionId);
    } catch {
      this.log("JSON parse error");
      return null;
    }
  }

  private handleEvent(event: CodexEvent, sessionId: string): { type: "text"; text: string } | null {
    switch (event.type) {
      case "thread.started":
        this.threadIds.set(sessionId, event.thread_id);
        this.log("Thread started:", event.thread_id);
        this.emit("init", { sessionId, cliSessionId: event.thread_id });
        break;

      case "turn.started":
        this.log("Turn started");
        break;

      case "item.started":
      case "item.updated":
        if (event.item.type === "command_execution" || 
            event.item.type === "file_read" || 
            event.item.type === "file_write") {
          const toolBlock: ToolUseBlock = {
            type: "tool_use",
            id: event.item.id,
            name: event.item.type,
            input: { command: event.item.command }
          };
          const pending = this.pendingMessages.get(sessionId);
          if (pending && event.type === "item.started") {
            pending.tools.push(toolBlock);
          }
          this.emit("toolUse", { sessionId, tool: toolBlock });
        }
        break;

      case "item.completed":
        if (event.item.type === "agent_message" && event.item.text) {
          this.log("Agent message:", event.item.text.substring(0, 50));
          return { type: "text", text: event.item.text };
        }
        break;

      case "turn.completed":
        this.log("Turn completed, usage:", event.usage);
        this.emit("result", { 
          sessionId, 
          result: { 
            type: "result",
            subtype: "success",
            is_error: false,
            result: "",
            session_id: this.threadIds.get(sessionId) || "",
            total_cost_usd: 0,
            duration_ms: 0,
            duration_api_ms: 0,
            num_turns: 1,
            usage: {
              input_tokens: event.usage.input_tokens,
              output_tokens: event.usage.output_tokens,
              cache_read_input_tokens: event.usage.cached_input_tokens,
              cache_creation_input_tokens: 0
            }
          }
        });
        this.emit("contextUpdate", {
          sessionId,
          usage: {
            input_tokens: event.usage.input_tokens,
            output_tokens: event.usage.output_tokens,
            cache_read_input_tokens: event.usage.cached_input_tokens,
            cache_creation_input_tokens: 0
          }
        });
        break;

      case "error":
        this.log("Error:", event.message);
        this.emit("error", { sessionId, error: event.message });
        break;
    }
    return null;
  }

  abort(sessionId: string): void {
    const process = this.processes.get(sessionId);
    if (process) {
      process.kill("SIGTERM");
      this.processes.delete(sessionId);
      this.emit("complete", { sessionId, code: null });
    }
  }

  abortAll(): void {
    for (const [sessionId, process] of this.processes) {
      process.kill("SIGTERM");
      this.emit("complete", { sessionId, code: null });
    }
    this.processes.clear();
    this.threadIds.clear();
    this.pendingMessages.clear();
  }

  getThreadId(sessionId: string): string | null {
    return this.threadIds.get(sessionId) || null;
  }

  isRunning(sessionId: string): boolean {
    return this.processes.has(sessionId);
  }

  hasAnyRunning(): boolean {
    return this.processes.size > 0;
  }

  clearSession(sessionId: string): void {
    this.threadIds.delete(sessionId);
    this.pendingMessages.delete(sessionId);
  }

  getPendingMessage(sessionId: string): PendingMessage | null {
    return this.pendingMessages.get(sessionId) || null;
  }
}
```

---

## Задача 2: Расширить types.ts

Добавить типы для Codex и унифицированного провайдера.

### Добавить в types.ts

```typescript
// ============================================================================
// AI Provider Types
// ============================================================================

export type AIProvider = "claude" | "codex";

export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface CodexPermissions {
  sandboxMode: CodexSandboxMode;
}

	export const CODEX_MODELS: { value: string; label: string }[] = [
	  { value: "gpt-5.2-codex", label: "GPT-5.2 Codex (best)" },
	  { value: "gpt-5.1-codex", label: "GPT-5.1 Codex" },
	  { value: "gpt-5.1-codex-mini", label: "GPT-5.1 Codex Mini (fast)" },
	  { value: "gpt-5.1", label: "GPT-5.1" }
	];

// Расширить ChatSession
export interface ChatSession {
  id: string;
  cliSessionId: string | null;  // Claude session ID или Codex thread_id
  messages: ChatMessage[];
  createdAt: number;
  title?: string;
  model?: ClaudeModel | string;  // Расширить тип для Codex моделей
  tokenStats?: SessionTokenStats;
  provider: AIProvider;  // НОВОЕ: какой провайдер использовался
}

// Расширить ClaudeRockSettings
export interface ClaudeRockSettings {
  // Claude
  cliPath: string;
  permissions: ClaudePermissions;
  defaultModel: ClaudeModel;
  
  // Codex (НОВОЕ)
  codexCliPath: string;
  codexPermissions: CodexPermissions;
  codexDefaultModel: string;
  
  // Общие
  defaultProvider: AIProvider;
  language: import("./systemPrompts").LanguageCode;
  customCommands: SlashCommand[];
  disabledBuiltinCommands: string[];
  thinkingEnabled: boolean;
  tokenHistory: Record<string, number>;
  gettingStartedDismissed: boolean;
}

// Расширить DEFAULT_SETTINGS
export const DEFAULT_SETTINGS: ClaudeRockSettings = {
  // Claude
  cliPath: "claude",
  permissions: {
    webSearch: false,
    webFetch: false,
    task: false
  },
  defaultModel: "claude-haiku-4-5-20251001",
  
  // Codex
  codexCliPath: "codex",
	  codexPermissions: {
	    sandboxMode: "read-only"
	  },
	  codexDefaultModel: "gpt-5.1-codex",
  
  // Общие
  defaultProvider: "claude",
  language: "en",
  customCommands: [],
  disabledBuiltinCommands: [],
  thinkingEnabled: false,
  tokenHistory: {},
  gettingStartedDismissed: false
};
```

---

## Задача 3: Расширить cliDetector.ts

Добавить детекцию Codex CLI.

### Добавить функции

```typescript
// Codex candidate paths
function getCodexCandidatePaths(): string[] {
  const homeDir = os.homedir();
  
  switch (process.platform) {
    case "darwin":
      return [
        "/usr/local/bin/codex",
        "/opt/homebrew/bin/codex",
        path.join(homeDir, ".cargo/bin/codex"),
        path.join(homeDir, ".local/bin/codex"),
      ];
    case "linux":
      return [
        "/usr/local/bin/codex",
        "/usr/bin/codex",
        path.join(homeDir, ".cargo/bin/codex"),
        path.join(homeDir, ".local/bin/codex"),
      ];
    case "win32":
      return [
        path.join(homeDir, ".cargo/bin/codex.exe"),
        "C:\\Program Files\\codex\\codex.exe",
      ];
    default:
      return [];
  }
}

function findCodexViaWhich(): string | null {
  try {
    const cmd = process.platform === "win32" ? "where" : "which";
    const result = execSync(`${cmd} codex`, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"]
    }).trim();
    return result.split("\n")[0] || null;
  } catch {
    return null;
  }
}

export function detectCodexCLIPath(): CLIDetectionResult {
  // 1. Try which/where
  const whichPath = findCodexViaWhich();
  if (whichPath) {
    return { found: true, path: whichPath, method: "which" };
  }

  // 2. Check known paths
  for (const candidatePath of getCodexCandidatePaths()) {
    if (fs.existsSync(candidatePath)) {
      return { found: true, path: candidatePath, method: "explicit" };
    }
  }

  // 3. Return default
  return { found: false, path: "codex", method: "default" };
}

export async function checkCodexInstalled(cliPath: string): Promise<CLIStatusResult> {
  return new Promise((resolve) => {
    const pathAdditions = ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin"];
    const homeDir = process.env.HOME || os.homedir();
    const env = {
      ...process.env,
      PATH: pathAdditions.join(":") + ":" + (process.env.PATH || ""),
      HOME: homeDir,
    };

    const proc = spawn(cliPath, ["--version"], {
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
      env
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => { stdout += data.toString(); });
    proc.stderr?.on("data", (data) => { stderr += data.toString(); });

    proc.on("close", (code) => {
      if (code === 0 && stdout.trim()) {
        const versionMatch = stdout.trim().match(/(\d+\.\d+\.\d+)/);
        resolve({
          installed: true,
          version: versionMatch ? versionMatch[1] : stdout.trim().split("\n")[0]
        });
      } else {
        resolve({
          installed: false,
          error: stderr.trim() || "Codex CLI not found"
        });
      }
    });

    proc.on("error", (err) => {
      resolve({ installed: false, error: err.message });
    });
  });
}
```

---

## Задача 4: Обновить main.ts

Добавить инициализацию CodexService.

### Изменения в main.ts

```typescript
import { CodexService } from "./CodexService";
import { detectCodexCLIPath } from "./cliDetector";

export default class ClaudeRockPlugin extends Plugin {
  settings: ClaudeRockSettings;
  claudeService: ClaudeService;
  codexService: CodexService;  // НОВОЕ
  // ...

  async onload(): Promise<void> {
    await this.loadSettings();

    const vaultPath = this.app.vault.adapter instanceof FileSystemAdapter
      ? this.app.vault.adapter.getBasePath()
      : process.cwd();
    
    // Claude service
    this.claudeService = new ClaudeService(this.settings.cliPath, vaultPath);
    this.claudeService.setPermissions(this.settings.permissions);
    
    // Codex service (НОВОЕ)
    this.codexService = new CodexService(this.settings.codexCliPath, vaultPath);
    this.codexService.setSandboxMode(this.settings.codexPermissions.sandboxMode);

    // ... rest of onload
  }

  async loadSettings(): Promise<void> {
    // ... existing code ...
    
    // Auto-detect Codex CLI on first launch
    if (!data) {
      const detectedCodex = detectCodexCLIPath();
      if (detectedCodex.found) {
        this.settings.codexCliPath = detectedCodex.path;
        console.log(`Claude Rock: Auto-detected Codex CLI at ${detectedCodex.path}`);
      }
    }
  }

  async saveSettings(): Promise<void> {
    // ... existing code ...
    
    // Update Codex service
    this.codexService.setCliPath(this.settings.codexCliPath);
    this.codexService.setSandboxMode(this.settings.codexPermissions.sandboxMode);
  }

  onunload(): void {
    this.claudeService.abortAll();
    this.codexService.abortAll();  // НОВОЕ
    // ...
  }
  
  // Геттер для текущего сервиса
  getActiveService(): ClaudeService | CodexService {
    const session = this.getCurrentSession();
    const provider = session?.provider || this.settings.defaultProvider;
    return provider === "codex" ? this.codexService : this.claudeService;
  }
}
```

---

## Задача 5: Обновить settings.ts

Добавить секцию настроек Codex.

### Структура новой секции

```typescript
// После секции Claude CLI Settings добавить:

// ==================== Codex CLI Settings ====================
containerEl.createEl("h3", { text: "Codex CLI" });

// Codex CLI Path
new Setting(containerEl)
  .setName("Codex CLI path")
  .setDesc("Path to the Codex CLI executable")
  .addText(text => text
    .setPlaceholder("codex")
    .setValue(this.plugin.settings.codexCliPath)
    .onChange(async (value) => {
      this.plugin.settings.codexCliPath = value;
      await this.plugin.saveSettings();
    }))
  .addButton(button => button
    .setButtonText("Detect")
    .onClick(async () => {
      const detected = detectCodexCLIPath();
      if (detected.found) {
        this.plugin.settings.codexCliPath = detected.path;
        await this.plugin.saveSettings();
        this.display(); // Refresh
      }
    }))
  .addButton(button => button
    .setButtonText("Test")
    .onClick(async () => {
      const status = await checkCodexInstalled(this.plugin.settings.codexCliPath);
      if (status.installed) {
        new Notice(`Codex CLI v${status.version} found`);
      } else {
        new Notice(`Codex CLI not found: ${status.error}`);
      }
    }));

// Sandbox Mode
new Setting(containerEl)
  .setName("Sandbox mode")
  .setDesc("Controls what Codex can do in your vault")
  .addDropdown(dropdown => dropdown
    .addOption("read-only", "Read only (safest)")
    .addOption("workspace-write", "Can edit files")
    .addOption("danger-full-access", "Full access (dangerous)")
    .setValue(this.plugin.settings.codexPermissions.sandboxMode)
    .onChange(async (value: CodexSandboxMode) => {
      this.plugin.settings.codexPermissions.sandboxMode = value;
      await this.plugin.saveSettings();
    }));

// Default Model
new Setting(containerEl)
  .setName("Default model")
  .setDesc("Default Codex model to use")
  .addDropdown(dropdown => {
    for (const model of CODEX_MODELS) {
      dropdown.addOption(model.value, model.label);
    }
    dropdown
      .setValue(this.plugin.settings.codexDefaultModel)
      .onChange(async (value) => {
        this.plugin.settings.codexDefaultModel = value;
        await this.plugin.saveSettings();
      });
  });

// ==================== General Settings ====================
containerEl.createEl("h3", { text: "General" });

// Default Provider
new Setting(containerEl)
  .setName("Default AI provider")
  .setDesc("Which AI to use by default for new chats")
  .addDropdown(dropdown => dropdown
    .addOption("claude", "Claude")
    .addOption("codex", "Codex")
    .setValue(this.plugin.settings.defaultProvider)
    .onChange(async (value: AIProvider) => {
      this.plugin.settings.defaultProvider = value;
      await this.plugin.saveSettings();
    }));
```

---

## Задача 6: Обновить ChatView.ts

Добавить переключатель провайдера и использовать нужный сервис.

### Ключевые изменения

1. **Добавить dropdown провайдера в header** (рядом с model selector)

```typescript
// В renderHeader() или где создаётся model selector
const providerSelect = headerEl.createEl("select", { cls: "provider-select" });
providerSelect.createEl("option", { value: "claude", text: "Claude" });
providerSelect.createEl("option", { value: "codex", text: "Codex" });
providerSelect.value = this.currentProvider;
providerSelect.addEventListener("change", (e) => {
  this.currentProvider = (e.target as HTMLSelectElement).value as AIProvider;
  this.updateModelOptions(); // Обновить список моделей
});
```

2. **Обновить sendMessage()** для выбора сервиса

```typescript
private async sendMessage(text: string): Promise<void> {
  const service = this.currentProvider === "codex" 
    ? this.plugin.codexService 
    : this.plugin.claudeService;
  
  const model = this.currentProvider === "codex"
    ? this.plugin.settings.codexDefaultModel
    : this.selectedModel;
  
  // Сохранить провайдер в сессии
  const session = this.plugin.getCurrentSession();
  if (session) {
    session.provider = this.currentProvider;
  }
  
  await service.sendMessage(text, this.sessionId, resumeId, model);
}
```

3. **Подписка на события обоих сервисов**

```typescript
private setupEventListeners(): void {
  // Claude events
  this.plugin.claudeService.on("streaming", this.handleStreaming);
  this.plugin.claudeService.on("complete", this.handleComplete);
  // ... остальные события
  
  // Codex events (те же обработчики, формат событий унифицирован)
  this.plugin.codexService.on("streaming", this.handleStreaming);
  this.plugin.codexService.on("complete", this.handleComplete);
  // ...
}
```

4. **Обновить список моделей при смене провайдера**

```typescript
private updateModelOptions(): void {
  const models = this.currentProvider === "codex" ? CODEX_MODELS : CLAUDE_MODELS;
  // Перерендерить dropdown моделей
}
```

---

## Задача 7: Локализация

Добавить строки для Codex в `settingsLocales.ts` и `buttonLocales.ts`.

### settingsLocales.ts

```typescript
// Добавить ключи
codexCliPath: {
  en: "Codex CLI path",
  ru: "Путь к Codex CLI",
  // ...
},
codexSandboxMode: {
  en: "Sandbox mode",
  ru: "Режим песочницы",
  // ...
},
sandboxReadOnly: {
  en: "Read only (safest)",
  ru: "Только чтение (безопасно)",
  // ...
},
// и т.д.
```

---

## Порядок выполнения

1. **types.ts** — добавить типы (AIProvider, CodexPermissions, расширить Settings)
2. **CodexService.ts** — создать новый файл
3. **cliDetector.ts** — добавить функции детекции Codex
4. **main.ts** — инициализация CodexService
5. **settings.ts** — UI настроек Codex
6. **ChatView.ts** — переключатель провайдера
7. **Локализация** — перевести строки
8. **Тестирование** — проверить оба провайдера

---

## Тестирование

### Ручная проверка
```bash
# Проверить что Codex CLI работает
codex exec --json "list files in current directory"

# Ожидаемый вывод: JSON Lines с thread.started, item.*, turn.completed
```

### В плагине
1. Открыть настройки → проверить детекцию Codex CLI
2. Переключить провайдер на Codex
3. Отправить сообщение
4. Проверить streaming, tool use, результат
5. Проверить resume сессии

---

## Заметки

- Codex требует Git репозиторий по умолчанию. Для Obsidian vault без git добавить `--skip-git-repo-check`
- Для resume использовать `thread_id` из события `thread.started`: `codex exec resume <thread_id> "<prompt>"` (а `resume --last` оставить как ручной fallback)
- Credentials Codex хранит в `~/.codex/auth.json` — отдельно от Claude
