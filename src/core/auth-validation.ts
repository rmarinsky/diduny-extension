// A mailbox people can actually receive mail at: the RFC 5321/5322 dot-atom
// form (UTF-8 allowed per RFC 6531) at a public hostname. Quoted local parts,
// IP literals, dotless hosts ("d@t"), and one-letter or numeric top-level
// domains are refused; real providers don't issue them and they read as typos.
const ATOM_CHAR = String.raw`[A-Za-z0-9!#$%&'*+/=?^_\x60{|}~-]|[^\x00-\x7F\p{White_Space}\p{Cc}\p{Cf}]`;
const ATOM = String.raw`(?:${ATOM_CHAR})+`;
const LOCAL_PART = new RegExp(String.raw`^${ATOM}(?:\.${ATOM})*$`, "u");
const LABEL = String.raw`[\p{L}\p{N}](?:[\p{L}\p{N}\p{M}-]{0,61}[\p{L}\p{N}\p{M}])?`;
const HOSTNAME = new RegExp(String.raw`^${LABEL}(?:\.${LABEL})+$`, "u");
// Letters only (".com", ".укр"), or the punycode form of an internationalized one.
const TOP_LEVEL_DOMAIN = /^(?:\p{L}[\p{L}\p{M}]{1,62}|xn--[a-z0-9-]{1,59})$/iu;

const MAX_ADDRESS_OCTETS = 254;
const MAX_LOCAL_PART_OCTETS = 64;
const MAX_HOSTNAME_LENGTH = 253;

const utf8 = new TextEncoder();

function octets(value: string) {
	return utf8.encode(value).length;
}

function isValidDomain(domain: string) {
	if (domain.length > MAX_HOSTNAME_LENGTH || !HOSTNAME.test(domain))
		return false;
	return TOP_LEVEL_DOMAIN.test(domain.slice(domain.lastIndexOf(".") + 1));
}

export function isValidEmail(value: unknown): value is string {
	if (typeof value !== "string" || octets(value) > MAX_ADDRESS_OCTETS)
		return false;
	const at = value.lastIndexOf("@");
	if (at < 1) return false;
	const localPart = value.slice(0, at);
	return (
		octets(localPart) <= MAX_LOCAL_PART_OCTETS &&
		LOCAL_PART.test(localPart) &&
		isValidDomain(value.slice(at + 1))
	);
}

/** Trims pasted whitespace and applies the NFC form RFC 6532 recommends. */
export function normalizeEmail(value: string) {
	return value.trim().normalize("NFC");
}

/** Drops the spaces a code picks up when pasted from an email ("123 456"). */
export function normalizeOtp(value: string) {
	return value.replace(/\s+/g, "");
}

export function isValidOtp(value: unknown): value is string {
	return typeof value === "string" && /^\d{6}$/.test(value);
}
