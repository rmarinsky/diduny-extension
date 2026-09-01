import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { en } from "../web/src/locales/en";
import { uk } from "../web/src/locales/uk";

const webSource = new URL("../web/src/", import.meta.url).pathname;
const userVisibleAttributes = new Set([
	"alt",
	"aria-label",
	"placeholder",
	"title",
]);

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return entry.name.endsWith(".tsx") && !entry.name.endsWith(".test.tsx")
			? [path]
			: [];
	});
}

function text(value: ts.JsxText | ts.StringLiteral) {
	return value.text.replace(/\s+/g, " ").trim();
}

function hasVisibleCharacters(value: string) {
	return /[\p{L}\p{N}]/u.test(value);
}

function report(
	file: string,
	node: ts.Node,
	message: string,
	failures: string[],
) {
	const position = node
		.getSourceFile()
		.getLineAndCharacterOfPosition(node.getStart());
	failures.push(
		`${file}:${position.line + 1}:${position.character + 1} ${message}`,
	);
}

function checkFile(file: string, failures: string[]) {
	const source = ts.createSourceFile(
		file,
		readFileSync(file, "utf8"),
		ts.ScriptTarget.Latest,
		true,
		ts.ScriptKind.TSX,
	);
	const visit = (node: ts.Node) => {
		if (ts.isJsxText(node) && hasVisibleCharacters(text(node))) {
			report(file, node, "visible JSX text must use a locale key", failures);
		}
		if (ts.isJsxAttribute(node)) {
			const name = node.name.getText(source);
			const value = node.initializer;
			if (
				userVisibleAttributes.has(name) &&
				value &&
				ts.isStringLiteral(value) &&
				hasVisibleCharacters(text(value))
			) {
				report(file, node, `${name} must use a locale key`, failures);
			}
		}
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			(node.expression.text === "setMessage" ||
				node.expression.text === "setStatus")
		) {
			const argument = node.arguments[0];
			if (
				argument &&
				ts.isStringLiteral(argument) &&
				hasVisibleCharacters(text(argument))
			) {
				report(
					file,
					node,
					`${node.expression.text} must use a locale key`,
					failures,
				);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
}

function flatten(value: Record<string, unknown>, prefix = ""): string[] {
	return Object.entries(value).flatMap(([key, child]) => {
		const path = prefix ? `${prefix}.${key}` : key;
		return child && typeof child === "object" && !Array.isArray(child)
			? flatten(child as Record<string, unknown>, path)
			: [path];
	});
}

const failures: string[] = [];
for (const file of sourceFiles(webSource)) checkFile(file, failures);
if (failures.length)
	throw new Error(`i18n literal guard failed:\n${failures.join("\n")}`);

const ukrainianKeys = new Set(flatten(uk));
const missingUkrainian = flatten(en).filter((key) => !ukrainianKeys.has(key));
if (missingUkrainian.length) {
	console.warn(
		`[i18n] warning: Ukrainian catalogue is missing ${missingUkrainian.length} English keys.`,
	);
}
