import {
	App,
	Editor,
	MarkdownView,
	normalizePath,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";

import { diff } from "fast-myers-diff";

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

// CHALLENGES:
// - when lines below are pushed down, all subsequent timestamps need to be updated. (hash)
// - hashed lines need to also store order, since multiple lines can have the same hash.
// - only write to file if there is difference in minute and hour of time to last write.
// - deleted lines should be removed from hash.

// - maybe compare entire file each time to check for changes, then update timestamps.
// - then we're using myers diff. try to implement it.

// figure out diff.
// store a diff on file load.
// on file change, check diff. if changes, check timestamps. if timestamps changed, write.

// - optimize:
// - store timestamps for each line and paragraph. if a line inside a paragraph is edited, break paragraph timestamps.

interface TimestampsSettings {
	timestampLogLocation: string;
}

type TimestampsType = {
	[fileName: string]: {
		[lineNumber: number]: string;
	};
};

const DEFAULT_SETTINGS: TimestampsSettings = {
	timestampLogLocation: "/.timestamps/",
};

export default class Timestamps extends Plugin {
	settings: TimestampsSettings;
	canSaveCache: boolean;
	saveCacheTimer?: NodeJS.Timeout;

	METADATA_DIR = normalizePath(".timestamps/plugin-data/");
	METADATA_FILE = normalizePath(`${this.METADATA_DIR}/timestamps.json`);

	async onload() {
		await this.loadSettings();

		this.canSaveCache = false;

		this.addSettingTab(new TimestampSettingsTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on("editor-change", this.handleEditorChange)
		);
		this.registerEvent(
			this.app.workspace.on("file-open", async (file: TFile) => {
				const timeStamps = await this.loadMetadata();
				console.log(timeStamps);
				const view =
					this.app.workspace.getActiveViewOfType(MarkdownView);
				if (view) this.overlayTimestamps(view, timeStamps); //TODO: run in its own view onload. currently only gets called when plugin reloads bc view doesn't exist on first load.
			})
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
		console.log("path", file?.path);
		// if (!this.canSaveCache && file) {
		if (file) {
			const { line } = editor.getCursor("from");
			await this.updateLineTimestamp(
				file.path,
				line,
				new Date().toISOString()
			);
			// this.canSaveCache = true;

			// TODO: make timestamp update based on edit end, rather than timer.
			// TODO: save timestamps to cache, reset timer on cache change. when timer hits end, save to file.
			// if (!this.saveCacheTimer) {
			// 	this.saveCacheTimer = setTimeout(() => {
			// 		console.log("timer expired", this.saveCacheTimer);
			// 		this.canSaveCache = false;
			// 		this.saveCacheTimer = undefined;
			// 	}, 2000);
			// 	console.log("timer created", this.saveCacheTimer);
			// }
		}
	};

	overlayTimestamps(view: MarkdownView, timestamps: TimestampsType) {
		console.log("overlaying", timestamps);
		let existingOverlay = document.querySelector(
			".timestamp-overlay-container"
		);
		if (existingOverlay) {
			existingOverlay.remove();
		}

		// container to store timestamp overlays
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

class TimestampSettingsTab extends PluginSettingTab {
	plugin: Timestamps;

	constructor(app: App, plugin: Timestamps) {
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
