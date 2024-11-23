import {
	App,
	Editor,
	MarkdownView,
	Modal,
	normalizePath,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	View,
} from "obsidian";

import * as YAML from "js-yaml";

// Remember to rename these classes and interfaces!

// TODO:
// - for each edited line, add a timestamp to YAML frontmatter.
// - upon page load, add timestamps to DOM rather than md: Plugin with JavaScript DOM Manipulation
/*
const addTimestamp = (lineElement, timestamp) => {
  // Create an uneditable span for the timestamp
  const timestampElement = document.createElement('span');
  timestampElement.className = 'timestamp-overlay';
  timestampElement.textContent = timestamp;

  // Style it so it doesn't interfere with editing
  timestampElement.style.pointerEvents = 'none';
  timestampElement.style.position = 'absolute';
  timestampElement.style.right = '10px'; // Position it to the right of the line
  timestampElement.style.opacity = '0.5';

  // Append it to the line element
  lineElement.appendChild(timestampElement);
};
*/

interface MyPluginSettings {
	timestampLogLocation: string;
}

type Timestamps = {
	[fileName: string]: {
		[lineNumber: number]: string;
	};
};

const DEFAULT_SETTINGS: MyPluginSettings = {
	timestampLogLocation: "/.timestamps/",
};

export default class MyPlugin extends Plugin {
	settings: MyPluginSettings;
	updatedTimestamp: boolean;
	updateTimer?: NodeJS.Timeout;

	METADATA_DIR = normalizePath(".timestamps/plugin-data/");
	METADATA_FILE = normalizePath(`${this.METADATA_DIR}/timestamps.json`);

	async onload() {
		await this.loadSettings();

		this.updatedTimestamp = false;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const timeStamps = await this.loadMetadata();
		console.log(timeStamps);
		if (view) this.overlayTimestamps(view, timeStamps); //TODO: run in its own view onload. currently only gets called when plugin reloads bc view doesn't exist on first load.

		// This creates an icon in the left ribbon.
		const ribbonIconEl = this.addRibbonIcon(
			"dice",
			"Sample Plugin",
			(evt: MouseEvent) => {
				// Called when the user clicks the icon.
				new Notice("This is a notice!");
			}
		);
		// Perform additional things with the ribbon
		ribbonIconEl.addClass("my-plugin-ribbon-class");

		// This adds a status bar item to the bottom of the app. Does not work on mobile apps.
		const statusBarItemEl = this.addStatusBarItem();
		statusBarItemEl.setText("Status Bar Text");

		// This adds a simple command that can be triggered anywhere
		this.addCommand({
			id: "open-sample-modal-simple",
			name: "Open sample modal (simple)",
			callback: () => {
				new SampleModal(this.app).open();
			},
		});
		// This adds an editor command that can perform some operation on the current editor instance
		this.addCommand({
			id: "sample-editor-command",
			name: "Sample editor command",
			editorCallback: (editor: Editor, view: MarkdownView) => {
				console.log(editor.getSelection());
				editor.replaceSelection("Sample Editor Command");
			},
		});
		// This adds a complex command that can check whether the current state of the app allows execution of the command
		this.addCommand({
			id: "open-sample-modal-complex",
			name: "Open sample modal (complex)",
			checkCallback: (checking: boolean) => {
				// Conditions to check
				const markdownView =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (markdownView) {
					// If checking is true, we're simply "checking" if the command can be run.
					// If checking is false, then we want to actually perform the operation.
					if (!checking) {
						new SampleModal(this.app).open();
					}

					// This command will only show up in Command Palette when the check function returns true
					return true;
				}
			},
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SampleSettingTab(this.app, this));

		// If the plugin hooks up any global DOM events (on parts of the app that doesn't belong to this plugin)
		// Using this function will automatically remove the event listener when this plugin is disabled.
		this.registerDomEvent(document, "click", (evt: MouseEvent) => {
			console.log("click", evt);
		});

		// When registering intervals, this function will automatically clear the interval when the plugin is disabled.
		this.registerInterval(
			window.setInterval(() => console.log("setInterval"), 5 * 60 * 1000)
		);

		this.registerEvent(
			this.app.workspace.on("editor-change", this.handleEditorChange)
		);
	}

	/**
	 * Load metadata from the JSON file.
	 *
	 * @returns A promise that resolves to the metadata object.
	 */
	async loadMetadata(): Promise<Record<string, any>> {
		const metadataFile = await this.app.vault.adapter.read(
			this.METADATA_FILE
		);
		console.log("loading metadata", metadataFile);
		return JSON.parse(metadataFile);
	}

	/**
	 * Save metadata to the JSON file.
	 *
	 * @param app - The Obsidian app instance.
	 * @param metadata - The metadata object to save.
	 * @returns A promise that resolves when the file is saved.
	 */
	async saveMetadata(metadata: Record<string, any>): Promise<void> {
		const content = JSON.stringify(metadata, null, 2);
		console.log("saving metadata", content);

		try {
			await this.app.vault.createFolder(this.METADATA_DIR);
		} catch (e) {
			// folder exists
		}

		try {
			await this.app.vault.create(this.METADATA_FILE, content);
		} catch (e) {
			// file exists
			await this.app.vault.adapter.write(this.METADATA_FILE, content);
		}
	}

	/**
	 * Update the timestamp for a specific line in a specific file.
	 *
	 * @param app - The Obsidian app instance.
	 * @param filePath - The path of the file.
	 * @param lineNumber - The line number to update.
	 * @param timestamp - The timestamp to save for the line.
	 * @returns A promise that resolves when the timestamp is updated.
	 */
	async updateLineTimestamp(
		filePath: string,
		lineNumber: number,
		timestamp: string
	): Promise<void> {
		console.log("updating timestamp at", filePath, lineNumber);
		const metadata = await this.loadMetadata();

		if (!metadata[filePath]) {
			metadata[filePath] = {};
		}

		metadata[filePath][lineNumber.toString()] = timestamp;

		await this.saveMetadata(metadata);
		this.overlayTimestamps(
			this.app.workspace.getActiveViewOfType(MarkdownView)!,
			metadata
		);
	}

	handleEditorChange = async (editor: Editor) => {
		const file = this.app.workspace.getActiveFile();
		if (!this.updatedTimestamp && file) {
			const { line } = editor.getCursor("from");
			await this.updateLineTimestamp(
				file.path,
				line,
				new Date().toISOString()
			);
			this.updatedTimestamp = true;

			// TODO: make timestamp update based on edit end, rather than timer.
			if (!this.updateTimer) {
				this.updateTimer = setTimeout(() => {
					console.log("timer expired", this.updateTimer);
					this.updatedTimestamp = false;
					this.updateTimer = undefined;
				}, 2000);
				console.log("timer created", this.updateTimer);
			}
		}
	};

	// Function to overlay timestamps on the editor
	overlayTimestamps(view: MarkdownView, timestamps: Timestamps) {
		// Remove any existing overlay container
		console.log("overlaying", timestamps);
		let existingOverlay = document.querySelector(
			".timestamp-overlay-container"
		);
		if (existingOverlay) {
			existingOverlay.remove();
		}

		// Create a container for all timestamp overlays
		const overlayContainer = document.createElement("div");
		overlayContainer.className = "timestamp-overlay-container";
		overlayContainer.style.position = "absolute";
		overlayContainer.style.top = "0";
		overlayContainer.style.left = "0";
		overlayContainer.style.pointerEvents = "none"; // Make it unclickable
		overlayContainer.style.zIndex = "10";

		view.containerEl.appendChild(overlayContainer);

		let lines = view.containerEl.getElementsByClassName("cm-line");

		// line position is line.getBoundingClientRect().too -  (40 vertically aligned middle, 36 vertically aligned bottom of text)  and left is arbitrary.
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i] as HTMLElement;
			const lineText = view.editor.getLine(i);
			const lineCoords = line.getBoundingClientRect();
			const fileName = this.app.workspace.getActiveFile()?.name;
			console.log("file, text", fileName, lineText);
			if (!fileName) return;
			const timestamp = timestamps[fileName][i];
			console.log(i, line, lineCoords, timestamp);
			if (timestamp && lineText) {
				const timestampElement = document.createElement("div");
				timestampElement.className = "timestamp-overlay";
				timestampElement.textContent = new Date(
					timestamp
				).toLocaleTimeString("en-US", {
					hour: "2-digit",
					minute: "2-digit",
				});
				timestampElement.style.position = "absolute";
				timestampElement.style.pointerEvents = "none";
				timestampElement.style.opacity = "0.7";
				timestampElement.style.backgroundColor = "#f0f0f0";
				timestampElement.style.color = "#333";
				timestampElement.style.padding = "2px 4px";
				timestampElement.style.fontSize = "12px";
				timestampElement.style.borderRadius = "3px";
				timestampElement.style.width = "60px";
				timestampElement.style.top = `${lineCoords.top - 36}px`; // adjust for gap and text alignment
				timestampElement.style.left = `${lineCoords.left - 500}px`; // position to left of line

				overlayContainer.appendChild(timestampElement);
			}
		}
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

class SampleModal extends Modal {
	constructor(app: App) {
		super(app);
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.setText("Woah!");
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName("Timestamp Log Location")
			.setDesc("Directory where you store all your file timestamps")
			.addText((text) =>
				text
					.setPlaceholder("path")
					.setValue(this.plugin.settings.timestampLogLocation)
					.onChange(async (value) => {
						this.plugin.settings.timestampLogLocation = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
