import type { TestInfo } from "@playwright/test";

/**
 * Exploratory charters turned into repeatable checks: a seeded random walk
 * over the actions a charter names, with the charter's invariants checked
 * after every step. The same seed always takes the same path, so a failure
 * replays exactly.
 *
 *   CHARTER_SEEDS=4,5,6   walk other paths (default 1,2,3)
 *   CHARTER_STEPS=40      walk further (default 15)
 */

/** mulberry32: small, fast, and fully determined by its seed. */
export function seededRandom(seed: number) {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
	};
}

export function charterSeeds() {
	const seeds = (process.env.CHARTER_SEEDS ?? "1,2,3")
		.split(",")
		.map((seed) => Number(seed.trim()))
		.filter((seed) => Number.isInteger(seed));
	return seeds.length ? seeds : [1, 2, 3];
}

export function charterSteps() {
	const steps = Number(process.env.CHARTER_STEPS ?? 15);
	return Number.isInteger(steps) && steps > 0 ? steps : 15;
}

/** How quickly the charter's persona moves between actions. */
export interface Persona {
	gapMs: readonly [number, number];
	name: string;
}

export const SPEEDRUNNER: Persona = { gapMs: [0, 50], name: "Speedrunner" };
export const NEW_USER: Persona = { gapMs: [300, 1_500], name: "New user" };

export interface CharterAction<Model> {
	/** Whether the action makes sense in the current model state. */
	enabled?(model: Model): boolean;
	name: string;
	run(model: Model, random: () => number): Promise<void>;
	weight?: number;
}

export function pick<T>(random: () => number, items: readonly T[]): T {
	const item = items[Math.floor(random() * items.length)];
	if (item === undefined) throw new Error("Nothing to pick from");
	return item;
}

/**
 * Walks `steps` weighted random actions from `actions`, checking `check`
 * after each one. The trail is attached to the test, and a failure says how
 * to replay it.
 */
export async function walk<Model>({
	actions,
	check,
	model,
	persona,
	seed,
	steps = charterSteps(),
	testInfo,
}: {
	actions: readonly CharterAction<Model>[];
	check(model: Model): Promise<void>;
	model: Model;
	persona: Persona;
	seed: number;
	steps?: number;
	testInfo: TestInfo;
}) {
	const random = seededRandom(seed);
	const trail: string[] = [`seed ${seed}, ${steps} steps, ${persona.name}`];
	try {
		for (let step = 1; step <= steps; step += 1) {
			const choices = actions.filter(
				(action) => action.enabled?.(model) ?? true,
			);
			if (!choices.length) throw new Error("No action is possible");
			const total = choices.reduce(
				(sum, action) => sum + (action.weight ?? 1),
				0,
			);
			let ticket = random() * total;
			const action =
				choices.find((choice) => {
					ticket -= choice.weight ?? 1;
					return ticket < 0;
				}) ?? (choices.at(-1) as CharterAction<Model>);
			trail.push(`${step}. ${action.name}`);
			await action.run(model, random);
			await check(model);
			const [min, max] = persona.gapMs;
			await new Promise((resolve) =>
				setTimeout(resolve, min + random() * (max - min)),
			);
		}
	} catch (error) {
		if (error instanceof Error)
			error.message += `\n\nReplay: CHARTER_SEEDS=${seed} CHARTER_STEPS=${steps} bun run test:e2e:charters -g "${testInfo.title}"\n${trail.join("\n")}`;
		throw error;
	} finally {
		await testInfo.attach(`trail-seed-${seed}.txt`, {
			body: trail.join("\n"),
			contentType: "text/plain",
		});
	}
}
