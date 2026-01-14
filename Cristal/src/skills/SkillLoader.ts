import type { Vault, TFolder, TFile } from "obsidian";
import { FileSystemAdapter } from "obsidian";
import * as path from "path";
import * as fs from "fs";
import type { Skill, SkillReference, SkillResource, SkillValidationResult } from "./types";
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

// Resource folder names
const RESOURCE_FOLDERS = ['scripts', 'references', 'assets'] as const;
type ResourceFolderType = typeof RESOURCE_FOLDERS[number];

/**
 * Loads and manages skills from builtin and vault sources
 * Supports full skill structure: SKILL.md + scripts/ + references/ + assets/
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
	 * (builtins don't have scripts/references/assets - they are pure instructions)
	 */
	private loadBuiltinSkills(): void {
		for (const raw of BUILTIN_SKILLS_RAW) {
			const parsed = SkillParser.parse(raw);
			if (parsed) {
				const skill: Skill = {
					id: parsed.metadata.name,
					metadata: parsed.metadata,
					instructions: parsed.instructions,
					isBuiltin: true,
					scripts: [],
					references: [],
					assets: []
				};
				this.builtinSkills.set(skill.id, skill);
			}
		}
	}

	/**
	 * Discover custom skills in vault's .cristal/skills/ folder
	 * Now also discovers scripts/, references/, assets/ subfolders
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
			const skill = await this.loadSkillFromFolder(skillFolder);
			if (skill) {
				this.vaultSkills.set(skill.id, skill);
			}
		}
	}

	/**
	 * Load a complete skill from a folder, including all resources
	 */
	private async loadSkillFromFolder(skillFolder: TFolder): Promise<Skill | null> {
		// Find SKILL.md
		const skillFile = skillFolder.children.find(
			(child) => child.name === "SKILL.md"
		) as TFile | undefined;

		if (!skillFile) {
			console.warn(`SkillLoader: No SKILL.md in ${skillFolder.path}`);
			return null;
		}

		try {
			const content = await this.vault.cachedRead(skillFile);
			const parsed = SkillParser.parse(content);

			if (!parsed || !SkillParser.isValidSkillName(parsed.metadata.name)) {
				console.warn(`SkillLoader: Invalid skill in ${skillFolder.path}`);
				return null;
			}

			// Load resources from subfolders
			const scripts = await this.loadResourceFolder(skillFolder, 'scripts');
			const references = await this.loadResourceFolder(skillFolder, 'references');
			const assets = await this.loadResourceFolder(skillFolder, 'assets');

			const skill: Skill = {
				id: parsed.metadata.name,
				metadata: parsed.metadata,
				instructions: parsed.instructions,
				isBuiltin: false,
				path: skillFolder.path,
				skillMdPath: skillFile.path,
				scripts,
				references,
				assets
			};

			return skill;
		} catch (e) {
			console.error(`SkillLoader: Failed to load skill from ${skillFolder.path}:`, e);
			return null;
		}
	}

	/**
	 * Load resources from a subfolder (scripts/, references/, assets/)
	 * Recursively collects all files
	 */
	private async loadResourceFolder(
		skillFolder: TFolder,
		resourceType: ResourceFolderType
	): Promise<SkillResource[]> {
		const resources: SkillResource[] = [];

		const resourceFolder = skillFolder.children.find(
			(child) => child.name === resourceType && (child as TFolder).children !== undefined
		) as TFolder | undefined;

		if (!resourceFolder) {
			return resources;
		}

		// Recursively collect all files in resource folder
		const collectFiles = (folder: TFolder, relativePath: string): void => {
			for (const child of folder.children) {
				if ((child as TFolder).children !== undefined) {
					// It's a subfolder - recurse
					collectFiles(
						child as TFolder,
						relativePath ? `${relativePath}/${child.name}` : child.name
					);
				} else {
					// It's a file - skip .gitkeep
					if (child.name === '.gitkeep') continue;

					const file = child as TFile;
					const relPath = relativePath
						? `${resourceType}/${relativePath}/${file.name}`
						: `${resourceType}/${file.name}`;

					resources.push({
						relativePath: relPath,
						absolutePath: file.path
					});
				}
			}
		};

		collectFiles(resourceFolder, '');
		return resources;
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
	 * Validate a skill folder
	 */
	async validateSkill(skillId: string): Promise<SkillValidationResult> {
		const skill = this.vaultSkills.get(skillId);
		if (!skill) {
			return {
				isValid: false,
				errors: [{ code: 'MISSING_SKILL_MD', message: 'Skill not found' }],
				warnings: []
			};
		}

		// Read SKILL.md content
		let content: string | null = null;
		if (skill.skillMdPath) {
			const file = this.vault.getAbstractFileByPath(skill.skillMdPath);
			if (file && 'extension' in file) {
				content = await this.vault.cachedRead(file as TFile);
			}
		}

		// Collect all files in skill folder
		const folder = this.vault.getAbstractFileByPath(skill.path!);
		const files: string[] = [];
		if (folder && (folder as TFolder).children) {
			const collectFiles = (f: TFolder, prefix: string): void => {
				for (const child of f.children) {
					if ((child as TFolder).children) {
						collectFiles(child as TFolder, prefix ? `${prefix}/${child.name}` : child.name);
					} else {
						const filePath = prefix ? `${prefix}/${child.name}` : child.name;
						files.push(filePath);
					}
				}
			};
			collectFiles(folder as TFolder, '');
		}

		return SkillParser.validate(content, files);
	}

	/**
	 * Sync enabled skills to CLI-specific directories
	 * Now copies entire skill structure including scripts/, references/, assets/
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

				await this.syncSingleSkill(skill, skillsDir, vaultPath);
			}

			console.log(`SkillLoader: Synced ${enabledSkillIds.length} skills for ${cliType}`);
		} catch (error) {
			console.error(`SkillLoader: Failed to sync skills for ${cliType}:`, error);
		}
	}

	/**
	 * Sync a single skill with all its resources
	 */
	private async syncSingleSkill(
		skill: Skill,
		targetSkillsDir: string,
		vaultPath: string
	): Promise<void> {
		const skillFolder = path.join(targetSkillsDir, skill.id);

		// Remove existing folder to ensure clean sync
		if (fs.existsSync(skillFolder)) {
			fs.rmSync(skillFolder, { recursive: true, force: true });
		}

		// Create skill folder
		fs.mkdirSync(skillFolder, { recursive: true });

		// Write SKILL.md
		const skillMdContent = this.buildSkillMdContent(skill);
		fs.writeFileSync(path.join(skillFolder, 'SKILL.md'), skillMdContent, 'utf-8');

		// For vault skills, copy resource folders
		if (!skill.isBuiltin && skill.path) {
			// Copy scripts
			if (skill.scripts.length > 0) {
				this.copyResourceFiles(skill.scripts, skillFolder, vaultPath);
			}

			// Copy references
			if (skill.references.length > 0) {
				this.copyResourceFiles(skill.references, skillFolder, vaultPath);
			}

			// Copy assets
			if (skill.assets.length > 0) {
				this.copyResourceFiles(skill.assets, skillFolder, vaultPath);
			}
		}

		console.log(`SkillLoader: Synced skill ${skill.id} to ${skillFolder}`);
	}

	/**
	 * Copy resource files to target directory
	 */
	private copyResourceFiles(
		resources: SkillResource[],
		targetSkillFolder: string,
		vaultPath: string
	): void {
		for (const resource of resources) {
			const sourcePath = path.join(vaultPath, resource.absolutePath);
			const targetPath = path.join(targetSkillFolder, resource.relativePath);

			// Ensure parent directory exists
			const parentDir = path.dirname(targetPath);
			if (!fs.existsSync(parentDir)) {
				fs.mkdirSync(parentDir, { recursive: true });
			}

			// Copy file
			if (fs.existsSync(sourcePath)) {
				fs.copyFileSync(sourcePath, targetPath);
			}
		}
	}

	/**
	 * Build SKILL.md content from skill object
	 */
	private buildSkillMdContent(skill: Skill): string {
		let frontmatter = `---\nname: ${skill.metadata.name}\ndescription: ${skill.metadata.description}`;

		if (skill.metadata.license) {
			frontmatter += `\nlicense: ${skill.metadata.license}`;
		}
		if (skill.metadata.compatibility) {
			frontmatter += `\ncompatibility: ${skill.metadata.compatibility}`;
		}

		frontmatter += `\n---\n\n`;

		return frontmatter + skill.instructions;
	}

	/**
	 * Create a new skill folder with template
	 */
	async createNewSkill(
		name: string,
		description: string,
		options: { includeScripts?: boolean; includeReferences?: boolean; includeAssets?: boolean }
	): Promise<{ success: boolean; path?: string; error?: string }> {
		// Validate name format
		if (!SkillParser.isValidSkillName(name)) {
			return {
				success: false,
				error: `Invalid skill name "${name}". Must be kebab-case (lowercase letters, digits, hyphens).`
			};
		}

		// Check if skill already exists
		if (this.vaultSkills.has(name) || this.builtinSkills.has(name)) {
			return { success: false, error: `Skill "${name}" already exists.` };
		}

		const skillPath = `${SKILLS_FOLDER}/${name}`;

		try {
			// Ensure .cristal/skills folder exists
			await this.ensureFolderExists(SKILLS_FOLDER);

			// Create skill folder
			await this.vault.createFolder(skillPath);

			// Create SKILL.md with template
			const skillMdContent = this.generateSkillMdTemplate(name, description);
			await this.vault.create(`${skillPath}/SKILL.md`, skillMdContent);

			// Create optional folders with .gitkeep
			if (options.includeScripts) {
				await this.vault.createFolder(`${skillPath}/scripts`);
				await this.vault.create(`${skillPath}/scripts/.gitkeep`, '');
			}

			if (options.includeReferences) {
				await this.vault.createFolder(`${skillPath}/references`);
				await this.vault.create(`${skillPath}/references/.gitkeep`, '');
			}

			if (options.includeAssets) {
				await this.vault.createFolder(`${skillPath}/assets`);
				await this.vault.create(`${skillPath}/assets/.gitkeep`, '');
			}

			// Refresh skills list
			await this.discoverVaultSkills();

			return { success: true, path: skillPath };
		} catch (error) {
			return { success: false, error: String(error) };
		}
	}

	/**
	 * Ensure a folder exists in vault (creates parent folders if needed)
	 */
	private async ensureFolderExists(folderPath: string): Promise<void> {
		const parts = folderPath.split('/');
		let currentPath = '';

		for (const part of parts) {
			currentPath = currentPath ? `${currentPath}/${part}` : part;
			const folder = this.vault.getAbstractFileByPath(currentPath);
			if (!folder) {
				await this.vault.createFolder(currentPath);
			}
		}
	}

	/**
	 * Generate SKILL.md template content
	 */
	private generateSkillMdTemplate(name: string, description: string): string {
		const title = this.kebabToTitle(name);
		return `---
name: ${name}
description: ${description}
---

# ${title}

## Overview

[Describe what this skill does and when to use it]

## Instructions

[Add specific instructions for the AI agent]

## Examples

[Add usage examples]
`;
	}

	/**
	 * Convert kebab-case to Title Case
	 */
	private kebabToTitle(kebab: string): string {
		return kebab
			.split('-')
			.map(word => word.charAt(0).toUpperCase() + word.slice(1))
			.join(' ');
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
