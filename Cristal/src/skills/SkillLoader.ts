import type { Vault, TFolder } from "obsidian";
import { FileSystemAdapter } from "obsidian";
import * as path from "path";
import * as fs from "fs";
import type { Skill, SkillReference } from "./types";
import { SkillParser } from "./SkillParser";
import type { CLIType } from "../types";

// Import builtin skills
import { OBSIDIAN_MARKDOWN_SKILL } from "./builtins/obsidian-markdown";
import { OBSIDIAN_CANVAS_SKILL } from "./builtins/obsidian-canvas";
import { OBSIDIAN_BASE_SKILL } from "./builtins/obsidian-base";
import { OBSIDIAN_LINKS_SKILL } from "./builtins/obsidian-links";
import { OBSIDIAN_TAGS_SKILL } from "./builtins/obsidian-tags";
import { OBSIDIAN_DATAVIEW_SKILL } from "./builtins/obsidian-dataview";

const BUILTIN_SKILLS_RAW: string[] = [
	OBSIDIAN_MARKDOWN_SKILL,
	OBSIDIAN_CANVAS_SKILL,
	OBSIDIAN_BASE_SKILL,
	OBSIDIAN_LINKS_SKILL,
	OBSIDIAN_TAGS_SKILL,
	OBSIDIAN_DATAVIEW_SKILL
];

const SKILLS_FOLDER = ".cristal/skills";

/**
 * Loads and manages skills from builtin and vault sources
 */
export class SkillLoader {
	private builtinSkills: Map<string, Skill> = new Map();
	private vaultSkills: Map<string, Skill> = new Map();

	constructor(private vault: Vault) {}

	/**
	 * Initialize by loading all skills
	 */
	async initialize(): Promise<void> {
		this.loadBuiltinSkills();
		await this.discoverVaultSkills();
	}

	/**
	 * Load builtin skills from embedded strings
	 */
	private loadBuiltinSkills(): void {
		for (const raw of BUILTIN_SKILLS_RAW) {
			const parsed = SkillParser.parse(raw);
			if (parsed) {
				const skill: Skill = {
					id: parsed.metadata.name,
					metadata: parsed.metadata,
					instructions: parsed.instructions,
					isBuiltin: true
				};
				this.builtinSkills.set(skill.id, skill);
			}
		}
	}

	/**
	 * Discover custom skills in vault's .cristal/skills/ folder
	 */
	async discoverVaultSkills(): Promise<void> {
		this.vaultSkills.clear();

		const folder = this.vault.getAbstractFileByPath(SKILLS_FOLDER);
		if (!folder || !(folder as TFolder).children) {
			return;
		}

		const skillFolders = (folder as TFolder).children.filter(
			(child) => (child as TFolder).children !== undefined
		) as TFolder[];

		for (const skillFolder of skillFolders) {
			const skillFile = skillFolder.children.find(
				(child) => child.name === "SKILL.md"
			);

			if (skillFile) {
				try {
					const content = await this.vault.cachedRead(skillFile as any);
					const parsed = SkillParser.parse(content);

					if (parsed && SkillParser.isValidSkillName(parsed.metadata.name)) {
						const skill: Skill = {
							id: parsed.metadata.name,
							metadata: parsed.metadata,
							instructions: parsed.instructions,
							isBuiltin: false,
							path: skillFile.path
						};
						this.vaultSkills.set(skill.id, skill);
					}
				} catch (e) {
					console.error(`Failed to load skill from ${skillFile.path}:`, e);
				}
			}
		}
	}

	/**
	 * Get all available skills as references (for UI)
	 */
	getSkillReferences(): SkillReference[] {
		const refs: SkillReference[] = [];

		// Builtin skills first
		for (const skill of this.builtinSkills.values()) {
			refs.push({
				id: skill.id,
				name: skill.metadata.name,
				description: skill.metadata.description,
				isBuiltin: true
			});
		}

		// Then vault skills (can override builtins by having same ID)
		for (const skill of this.vaultSkills.values()) {
			// Check if this overrides a builtin
			const existingIndex = refs.findIndex((r) => r.id === skill.id);
			if (existingIndex !== -1) {
				refs[existingIndex] = {
					id: skill.id,
					name: skill.metadata.name,
					description: skill.metadata.description,
					isBuiltin: false
				};
			} else {
				refs.push({
					id: skill.id,
					name: skill.metadata.name,
					description: skill.metadata.description,
					isBuiltin: false
				});
			}
		}

		return refs;
	}

	/**
	 * Get a specific skill by ID
	 * Vault skills take precedence over builtins
	 */
	getSkill(id: string): Skill | null {
		return this.vaultSkills.get(id) || this.builtinSkills.get(id) || null;
	}

	/**
	 * Build combined instructions from enabled skills
	 */
	buildSkillInstructions(enabledSkillIds: string[]): string {
		if (enabledSkillIds.length === 0) {
			return "";
		}

		const instructions: string[] = [];

		for (const id of enabledSkillIds) {
			const skill = this.getSkill(id);
			if (skill) {
				instructions.push(`## ${skill.metadata.name}\n\n${skill.instructions}`);
			}
		}

		if (instructions.length === 0) {
			return "";
		}

		return `# Active Skills\n\n${instructions.join("\n\n---\n\n")}`;
	}

	/**
	 * Refresh vault skills (call when files change)
	 */
	async refresh(): Promise<void> {
		await this.discoverVaultSkills();
	}

	/**
	 * Sync enabled skills to CLI-specific directories
	 * Creates SKILL.md files in .claude/skills/ or .codex/skills/
	 */
	async syncSkillsForAgent(cliType: CLIType, enabledSkillIds: string[]): Promise<void> {
		const adapter = this.vault.adapter;
		if (!(adapter instanceof FileSystemAdapter)) {
			console.warn("SkillLoader: Cannot sync skills - not a file system adapter");
			return;
		}

		const vaultPath = adapter.getBasePath();
		const skillsDir = cliType === "claude"
			? path.join(vaultPath, ".claude", "skills")
			: path.join(vaultPath, ".codex", "skills");

		try {
			// Create skills directory if it doesn't exist
			if (!fs.existsSync(skillsDir)) {
				fs.mkdirSync(skillsDir, { recursive: true });
			}

			// Get existing skill folders
			const existingFolders = fs.existsSync(skillsDir)
				? fs.readdirSync(skillsDir).filter(f =>
					fs.statSync(path.join(skillsDir, f)).isDirectory()
				)
				: [];

			// Remove skills that are no longer enabled
			for (const folder of existingFolders) {
				if (!enabledSkillIds.includes(folder)) {
					const folderPath = path.join(skillsDir, folder);
					fs.rmSync(folderPath, { recursive: true, force: true });
					console.log(`SkillLoader: Removed skill folder ${folderPath}`);
				}
			}

			// Create/update enabled skills
			for (const skillId of enabledSkillIds) {
				const skill = this.getSkill(skillId);
				if (!skill) continue;

				const skillFolder = path.join(skillsDir, skillId);
				const skillFile = path.join(skillFolder, "SKILL.md");

				// Create folder if needed
				if (!fs.existsSync(skillFolder)) {
					fs.mkdirSync(skillFolder, { recursive: true });
				}

				// Build SKILL.md content
				const content = `---
name: ${skill.metadata.name}
description: ${skill.metadata.description}
---

${skill.instructions}`;

				// Write file
				fs.writeFileSync(skillFile, content, "utf-8");
				console.log(`SkillLoader: Synced skill ${skillId} to ${skillFile}`);
			}

			console.log(`SkillLoader: Synced ${enabledSkillIds.length} skills for ${cliType}`);
		} catch (error) {
			console.error(`SkillLoader: Failed to sync skills for ${cliType}:`, error);
		}
	}

	/**
	 * Get vault base path (for external use)
	 */
	getVaultPath(): string | null {
		const adapter = this.vault.adapter;
		if (adapter instanceof FileSystemAdapter) {
			return adapter.getBasePath();
		}
		return null;
	}
}
