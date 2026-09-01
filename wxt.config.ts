import { defineConfig } from "wxt";

export default defineConfig({
	modules: ["@wxt-dev/module-react"],
	manifest: {
		name: "Diduny",
		description: "Voice dictation & meeting recording",
		minimum_chrome_version: "116",
		permissions: [
			"activeTab",
			"sidePanel",
			"desktopCapture",
			"offscreen",
			"scripting",
			"storage",
			"alarms",
			"tabs",
		],
		side_panel: {
			default_path: "sidepanel/index.html",
		},
		commands: {
			"toggle-recording": {
				suggested_key: {
					default: "Alt+Shift+D",
					mac: "Alt+Shift+D",
				},
				description: "Start/stop recording",
			},
		},
		action: {
			default_title: "Diduny",
			default_icon: {
				16: "icons/16.png",
				32: "icons/32.png",
				48: "icons/48.png",
				128: "icons/128.png",
			},
		},
	},
});
