import { expect, test } from "bun:test";
import {
	MAX_TERMS,
	addTerms,
	cleanTerm,
	splitDraft,
	splitTerms,
} from "./term-list";

test("keeps phrases and non-Latin words while dropping stray punctuation", () => {
	expect(cleanTerm("  you   know ")).toBe("you know");
	expect(cleanTerm("“um,”")).toBe("um");
	expect(cleanTerm("ну")).toBe("ну");
	expect(cleanTerm("so-called")).toBe("so-called");
	expect(cleanTerm("Node.js.")).toBe("Node.js");
	expect(cleanTerm("...")).toBe("");
});

test("splits pasted lists on commas, semicolons, and line breaks", () => {
	expect(splitTerms("um, uh;like\nтипу\r\n, ,")).toEqual([
		"um",
		"uh",
		"like",
		"типу",
	]);
});

test("adds new entries without case-insensitive duplicates or overflow", () => {
	expect(addTerms(["um"], "UM, uh, Uh")).toEqual(["um", "uh"]);
	const full = Array.from({ length: MAX_TERMS }, (_, index) => `w${index}`);
	expect(addTerms(full, "extra")).toHaveLength(MAX_TERMS);
});

test("commits finished entries and keeps the unfinished draft", () => {
	expect(splitDraft(["um"], "uh, lik")).toEqual({
		draft: "lik",
		terms: ["um", "uh"],
	});
	expect(splitDraft(["um"], "you know")).toEqual({
		draft: "you know",
		terms: ["um"],
	});
	expect(splitDraft([], "like,")).toEqual({ draft: "", terms: ["like"] });
});
