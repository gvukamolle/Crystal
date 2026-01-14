import { App, Modal, Setting, Notice, TextComponent, ToggleComponent } from "obsidian";
import type { SkillLoader } from "./SkillLoader";
import type { SkillReference } from "./types";
import { SkillParser } from "./SkillParser";

/**
 * Modal for creating a new skill
 */
export class CreateSkillModal extends Modal {
	private skillLoader: SkillLoader;
	private onSuccess: (skillId: string) => void;

	private nameInput!: TextComponent;
	private descInput!: TextComponent;
	private includeScripts = false;
	private includeReferences = false;
	private includeAssets = false;

	constructor(
		app: App,
		skillLoader: SkillLoader,
		onSuccess: (skillId: string) => void
	) {
		super(app);
		this.skillLoader = skillLoader;
		this.onSuccess = onSuccess;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('cristal-create-skill-modal');

		contentEl.createEl('h2', { text: 'Create New Skill' });

		// Name field
		new Setting(contentEl)
			.setName('Skill Name')
			.setDesc('Unique identifier in kebab-case (e.g., my-custom-skill)')
			.addText(text => {
				this.nameInput = text;
				text.setPlaceholder('my-skill-name')
					.onChange(value => {
						// Real-time validation feedback
						const isValid = SkillParser.isValidSkillName(value) || value === '';
						text.inputEl.classList.toggle('cristal-input-error', !isValid);
					});
			});

		// Description field
		new Setting(contentEl)
			.setName('Description')
			.setDesc('Detailed description for triggering (what it does, when to use)')
			.addText(text => {
				this.descInput = text;
				text.setPlaceholder('Describe what this skill does...');
				text.inputEl.style.width = '100%';
			});

		// Optional folders section
		contentEl.createEl('h3', { text: 'Optional Folders', cls: 'cristal-section-header' });

		new Setting(contentEl)
			.setName('Include scripts/')
			.setDesc('For executable code (Python, shell scripts)')
			.addToggle(toggle => {
				toggle.setValue(false);
				toggle.onChange(value => {
					this.includeScripts = value;
				});
			});

		new Setting(contentEl)
			.setName('Include references/')
			.setDesc('For documentation loaded into context')
			.addToggle(toggle => {
				toggle.setValue(false);
				toggle.onChange(value => {
					this.includeReferences = value;
				});
			});

		new Setting(contentEl)
			.setName('Include assets/')
			.setDesc('For output files (templates, images)')
			.addToggle(toggle => {
				toggle.setValue(false);
				toggle.onChange(value => {
					this.includeAssets = value;
				});
			});

		// Buttons
		const buttonContainer = contentEl.createDiv({ cls: 'cristal-modal-buttons' });

		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		const createBtn = buttonContainer.createEl('button', {
			text: 'Create Skill',
			cls: 'mod-cta'
		});
		createBtn.addEventListener('click', () => this.createSkill());
	}

	private async createSkill(): Promise<void> {
		const name = this.nameInput.getValue().trim();
		const description = this.descInput.getValue().trim();

		// Validation
		if (!name) {
			new Notice('Skill name is required');
			return;
		}

		if (!SkillParser.isValidSkillName(name)) {
			new Notice('Invalid skill name. Must be kebab-case (lowercase letters, digits, hyphens).');
			return;
		}

		if (!description) {
			new Notice('Description is required');
			return;
		}

		const result = await this.skillLoader.createNewSkill(name, description, {
			includeScripts: this.includeScripts,
			includeReferences: this.includeReferences,
			includeAssets: this.includeAssets
		});

		if (result.success) {
			this.onSuccess(name);
			this.close();
		} else {
			new Notice(result.error || 'Failed to create skill');
		}
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Modal for validating a skill
 */
export class ValidateSkillModal extends Modal {
	private skillLoader: SkillLoader;
	private skillId: string;

	constructor(app: App, skillLoader: SkillLoader, skillId: string) {
		super(app);
		this.skillLoader = skillLoader;
		this.skillId = skillId;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('cristal-validate-skill-modal');

		contentEl.createEl('h2', { text: `Validate: ${this.skillId}` });

		// Show loading
		const loadingEl = contentEl.createEl('p', { text: 'Validating...' });

		// Run validation
		const result = await this.skillLoader.validateSkill(this.skillId);

		loadingEl.remove();

		// Show result
		if (result.isValid) {
			const successEl = contentEl.createDiv({ cls: 'cristal-validation-success' });
			successEl.createEl('span', { text: '✓ Skill is valid' });
		} else {
			const errorEl = contentEl.createDiv({ cls: 'cristal-validation-errors' });
			errorEl.createEl('h3', { text: 'Errors' });
			const errorList = errorEl.createEl('ul');
			for (const error of result.errors) {
				const li = errorList.createEl('li');
				li.createEl('strong', { text: error.code });
				li.createSpan({ text: `: ${error.message}` });
			}
		}

		// Show warnings
		if (result.warnings.length > 0) {
			const warnEl = contentEl.createDiv({ cls: 'cristal-validation-warnings' });
			warnEl.createEl('h3', { text: 'Warnings' });
			const warnList = warnEl.createEl('ul');
			for (const warning of result.warnings) {
				const li = warnList.createEl('li');
				li.createEl('strong', { text: warning.code });
				li.createSpan({ text: `: ${warning.message}` });
			}
		}

		// Close button
		const buttonContainer = contentEl.createDiv({ cls: 'cristal-modal-buttons' });
		const closeBtn = buttonContainer.createEl('button', { text: 'Close', cls: 'mod-cta' });
		closeBtn.addEventListener('click', () => this.close());
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}

/**
 * Modal for selecting a skill from a list
 */
export class SkillSelectorModal extends Modal {
	private skills: SkillReference[];
	private onSelect: (skillId: string) => void;

	constructor(
		app: App,
		skills: SkillReference[],
		onSelect: (skillId: string) => void
	) {
		super(app);
		this.skills = skills;
		this.onSelect = onSelect;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('cristal-skill-selector-modal');

		contentEl.createEl('h2', { text: 'Select a Skill' });

		if (this.skills.length === 0) {
			contentEl.createEl('p', {
				text: 'No custom skills found in .cristal/skills/',
				cls: 'cristal-no-skills'
			});
		} else {
			const list = contentEl.createDiv({ cls: 'cristal-skill-list' });

			for (const skill of this.skills) {
				const item = list.createDiv({ cls: 'cristal-skill-item' });
				item.createEl('strong', { text: skill.name });
				item.createEl('p', { text: skill.description, cls: 'cristal-skill-desc' });

				item.addEventListener('click', () => {
					this.onSelect(skill.id);
					this.close();
				});
			}
		}

		// Cancel button
		const buttonContainer = contentEl.createDiv({ cls: 'cristal-modal-buttons' });
		const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());
	}

	onClose(): void {
		const { contentEl } = this;
		contentEl.empty();
	}
}
