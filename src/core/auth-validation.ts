export function isValidEmail(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length <= 254 &&
		new TextEncoder().encode(value).byteLength <= 254 &&
		/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
	);
}

export function isValidOtp(value: unknown): value is string {
	return typeof value === "string" && /^\d{6}$/.test(value);
}
