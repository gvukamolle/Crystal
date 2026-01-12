/**
 * Terminal Service
 *
 * Manages terminal sessions and PTY backends.
 * Handles backend selection (Python PTY vs Fallback) automatically.
 */

import { EventEmitter } from "events";
import { Notice } from "obsidian";
import type {
	IPtyBackend,
	PtySpawnOptions,
	TerminalProfile,
	TerminalSettings,
	TerminalSession,
	BackendType
} from "./types";
import { getDefaultProfiles, DEFAULT_TERMINAL_SETTINGS } from "./types";
import { PythonPtyBackend } from "./PythonPtyBackend";
import { FallbackPtyBackend } from "./FallbackPtyBackend";

export class TerminalService extends EventEmitter {
	private sessions: Map<string, { backend: IPtyBackend; session: TerminalSession }> = new Map();
	private settings: TerminalSettings;
	private vaultPath: string;
	private pythonPath: string | null = null;
	private pythonChecked: boolean = false;

	constructor(vaultPath: string, settings?: Partial<TerminalSettings>) {
		super();
		this.vaultPath = vaultPath;
		this.settings = {
			...DEFAULT_TERMINAL_SETTINGS,
			...settings,
			profiles: settings?.profiles || getDefaultProfiles()
		};
	}

	/**
	 * Set vault path (for working directory)
	 */
	setVaultPath(path: string): void {
		this.vaultPath = path;
	}

	/**
	 * Update settings
	 */
	updateSettings(settings: Partial<TerminalSettings>): void {
		this.settings = { ...this.settings, ...settings };
	}

	/**
	 * Create a new terminal session
	 */
	async createSession(sessionId?: string, profileId?: string): Promise<{
		backend: IPtyBackend;
		session: TerminalSession;
	}> {
		const id = sessionId || crypto.randomUUID();
		const profile = this.getProfile(profileId);

		// Check Python availability if not checked yet
		if (!this.pythonChecked) {
			await this.checkPython();
		}

		// Create appropriate backend
		const { backend, backendType } = await this.createBackend(profile);

		// Create session info
		const session: TerminalSession = {
			id,
			backendType,
			profile,
			createdAt: Date.now()
		};

		// Spawn shell process
		const spawnOptions: PtySpawnOptions = {
			shell: profile.shell,
			args: profile.args,
			cwd: this.vaultPath,
			env: profile.env,
			cols: 80,
			rows: 24
		};

		await backend.spawn(spawnOptions);

		// Forward events
		backend.on("data", (data: string) => {
			this.emit("data", { sessionId: id, data });
		});

		backend.on("exit", (code: number) => {
			this.emit("exit", { sessionId: id, code });
			this.sessions.delete(id);
		});

		backend.on("error", (error: Error) => {
			this.emit("error", { sessionId: id, error });
		});

		// Store session
		this.sessions.set(id, { backend, session });

		// Notify about backend type
		if (backendType === "fallback") {
			new Notice("Terminal running in limited mode (Python not found)", 3000);
		}

		return { backend, session };
	}

	/**
	 * Check Python availability
	 */
	private async checkPython(): Promise<void> {
		this.pythonChecked = true;

		// Check custom path first
		if (this.settings.pythonPath) {
			const version = await PythonPtyBackend.verifyPython(this.settings.pythonPath);
			if (version) {
				this.pythonPath = this.settings.pythonPath;
				console.log(`[Terminal] Using custom Python: ${version}`);
				return;
			}
		}

		// Auto-detect Python
		this.pythonPath = await PythonPtyBackend.findPython();
		if (this.pythonPath) {
			console.log(`[Terminal] Found Python: ${this.pythonPath}`);
		} else {
			console.log("[Terminal] Python not found, will use fallback backend");
		}
	}

	/**
	 * Create PTY backend based on availability
	 */
	private async createBackend(profile: TerminalProfile): Promise<{
		backend: IPtyBackend;
		backendType: BackendType;
	}> {
		const isWindows = process.platform === "win32";

		// On Windows without Python, use fallback
		if (isWindows && !this.pythonPath) {
			return {
				backend: new FallbackPtyBackend(),
				backendType: "fallback"
			};
		}

		// On Unix-like systems, try Python PTY
		if (this.pythonPath) {
			try {
				const backend = new PythonPtyBackend(this.pythonPath);
				return { backend, backendType: "python-pty" };
			} catch (error) {
				console.warn("[Terminal] Python PTY failed, using fallback:", error);
			}
		}

		// Fallback
		return {
			backend: new FallbackPtyBackend(),
			backendType: "fallback"
		};
	}

	/**
	 * Get profile by ID
	 */
	private getProfile(profileId?: string): TerminalProfile {
		const id = profileId || this.settings.defaultProfile;
		const profile = this.settings.profiles.find(p => p.id === id);

		if (profile) return profile;

		// Return first available profile
		const firstProfile = this.settings.profiles[0];
		if (firstProfile) {
			return firstProfile;
		}

		// Emergency fallback - get default profiles and return first one
		const defaultProfiles = getDefaultProfiles();
		return defaultProfiles[0] as TerminalProfile;
	}

	/**
	 * Get session by ID
	 */
	getSession(sessionId: string): { backend: IPtyBackend; session: TerminalSession } | undefined {
		return this.sessions.get(sessionId);
	}

	/**
	 * Kill a specific session
	 */
	killSession(sessionId: string): void {
		const entry = this.sessions.get(sessionId);
		if (entry) {
			entry.backend.kill();
			this.sessions.delete(sessionId);
		}
	}

	/**
	 * Kill all sessions
	 */
	killAll(): void {
		for (const [id, entry] of this.sessions) {
			entry.backend.kill();
		}
		this.sessions.clear();
	}

	/**
	 * Get all active sessions
	 */
	getActiveSessions(): TerminalSession[] {
		return Array.from(this.sessions.values()).map(e => e.session);
	}

	/**
	 * Check if Python PTY is available
	 */
	isPythonAvailable(): boolean {
		return this.pythonPath !== null;
	}

	/**
	 * Get available profiles
	 */
	getProfiles(): TerminalProfile[] {
		return this.settings.profiles;
	}
}
