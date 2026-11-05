type FormField = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Current value of the form field that dispatched `event` (DOM events are untyped in hono/jsx). */
export function targetValue(event: Event): string {
	return (event.target as FormField).value;
}

/** Current checked state of the checkbox that dispatched `event`. */
export function targetChecked(event: Event): boolean {
	return (event.target as HTMLInputElement).checked;
}
