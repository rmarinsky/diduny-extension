export interface DocumentPictureInPictureApi {
	requestWindow(options?: { height?: number; width?: number }): Promise<Window>;
}

interface PictureInPictureEnvironment {
	documentPictureInPicture?: { requestWindow?: unknown };
}

export function documentPictureInPictureApi(
	environment: PictureInPictureEnvironment = globalThis as unknown as PictureInPictureEnvironment,
): DocumentPictureInPictureApi | null {
	const api = environment.documentPictureInPicture;
	return typeof api?.requestWindow === "function"
		? (api as DocumentPictureInPictureApi)
		: null;
}

export function copyDocumentStyles(source: Document, target: Document) {
	for (const styleSheet of Array.from(source.styleSheets)) {
		if (styleSheet.href) {
			const link = target.createElement("link");
			link.rel = "stylesheet";
			link.href = styleSheet.href;
			target.head.append(link);
			continue;
		}
		try {
			const style = target.createElement("style");
			style.textContent = Array.from(styleSheet.cssRules)
				.map((rule) => rule.cssText)
				.join("\n");
			target.head.append(style);
		} catch {
			// A cross-origin stylesheet cannot be read; its linked styles still load normally.
		}
	}
}
