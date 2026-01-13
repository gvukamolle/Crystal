import type { SkillMetadata, ParsedSkill } from "./types";

/**
 * Parser for SKILL.md files with YAML frontmatter
 *
 * Format:
 * ---
 * name: skill-name
 * description: Skill description
 * ---
 *
 * # Instructions
 * ...markdown body...
 */
export class SkillParser {
	private static readonly FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

	/**
	 * Parse a complete SKILL.md file
	 */
	static parse(content: string): ParsedSkill | null {
		const match = content.match(this.FRONTMATTER_REGEX);
		if (!match) {
			return null;
		}

		const frontmatter = match[1];
		const body = match[2];
		if (!frontmatter || body === undefined) {
			return null;
		}

		const metadata = this.parseYaml(frontmatter);
		if (!metadata) {
			return null;
		}

		return {
			metadata,
			instructions: body.trim()
		};
	}

	/**
	 * Parse only the frontmatter metadata (for lazy loading)
	 */
	static parseMetadataOnly(content: string): SkillMetadata | null {
		const match = content.match(this.FRONTMATTER_REGEX);
		if (!match || !match[1]) {
			return null;
		}

		return this.parseYaml(match[1]);
	}

	/**
	 * Simple YAML parser for frontmatter
	 * Handles basic key: value pairs
	 */
	private static parseYaml(yaml: string): SkillMetadata | null {
		const lines = yaml.split("\n");
		const result: Record<string, string> = {};

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) {
				continue;
			}

			const colonIndex = trimmed.indexOf(":");
			if (colonIndex === -1) {
				continue;
			}

			const key = trimmed.slice(0, colonIndex).trim();
			let value = trimmed.slice(colonIndex + 1).trim();

			// Remove surrounding quotes if present
			if ((value.startsWith('"') && value.endsWith('"')) ||
				(value.startsWith("'") && value.endsWith("'"))) {
				value = value.slice(1, -1);
			}

			result[key] = value;
		}

		// Validate required fields
		if (!result.name || !result.description) {
			return null;
		}

		return {
			name: result.name,
			description: result.description
		};
	}

	/**
	 * Validate skill name format
	 * Must be lowercase with hyphens only
	 */
	static isValidSkillName(name: string): boolean {
		return /^[a-z][a-z0-9-]*$/.test(name) && name.length <= 64;
	}
}
