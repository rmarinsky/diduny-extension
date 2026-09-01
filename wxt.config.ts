import { defineConfig } from "wxt";

export default defineConfig({
	modules: ["@wxt-dev/module-react"],
	manifest: {
		key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA62KoXa1LqwFYRkOqshiZi6O6dfCDisx3otAqSASQGj+P366giF/4GsVSyOCzGExUntvo4jnhWvr1KX7I572nlGOWPj7ym1qtRDwe0BW0b10ylvCRwn/3yP4GzlM2JhOH6JTgrO1iUd6BlWh2sl2BWvYTyK5N9P8gDtU+SbrHECA0QKy4Xpvi9F6c6tcotjHCD84bmP8I85vPfamcZAf2sCBLGSiS94a2y/j2QvnI1GrUP4HbO5KmLaO6Q8oGNz/ol2kIYhGQdkBynK7Uw9a7Y5StA8+BBNnNW0/BvVqbfR0mjw3+SB9x7oOgF2lyjVc/Qm5heCQnEN1MI5+u38iZrQIDAQAB",
		name: "Diduny",
		description: "Voice dictation & meeting recording",
		minimum_chrome_version: "116",
		host_permissions: ["http://localhost/*"],
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
		options_ui: {
			open_in_tab: true,
			page: "options/index.html",
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
