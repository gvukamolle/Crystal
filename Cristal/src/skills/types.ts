// ============================================================================
// Skills System Types
// ============================================================================

/**
 * Metadata from SKILL.md YAML frontmatter
 */
export interface SkillMetadata {
	name: string;           // Unique skill ID (e.g., "obsidian-markdown")
	description: string;    // Description for UI and agent matching
}

/**
 * Full skill with instructions
 */
export interface Skill {
	id: string;             // Same as metadata.name
	metadata: SkillMetadata;
	instructions: string;   // Markdown body (agent instructions)
	isBuiltin: boolean;     // Built-in vs user-defined
	path?: string;          // Path to SKILL.md (for vault skills)
}

/**
 * Lightweight reference for UI lists (without full instructions)
 */
export interface SkillReference {
	id: string;
	name: string;
	description: string;
	isBuiltin: boolean;
}

/**
 * Result of parsing a SKILL.md file
 */
export interface ParsedSkill {
	metadata: SkillMetadata;
	instructions: string;
}
