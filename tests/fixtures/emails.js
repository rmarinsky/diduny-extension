// Addresses from the UI review: mailboxes people can receive mail at, and forms
// that are refused (including RFC-legal ones no real provider issues).
export const validEmails = [
	"simple@example.com",
	"very.common@example.com",
	"x@example.com",
	"long.email-address-with-hyphens@and.subdomains.example.com",
	"user.name+tag+sorting@example.com",
	"name/surname@example.com",
	"example@s.example",
	"mailhost!username@example.org",
	"user%example.com@example.org",
	"user-@example.org",
	"I❤️CHOCOLATE🍫@example.com",
	"користувач@приклад.укр",
	"user@example.xn--j1amh",
];

export const projectEmails = [
	"simple@project.com",
	"very.common@project.com",
	"very.common-and+unique@project.com",
	"very+unique@project.com",
	"x@project.com",
	"test/test@project.com",
	"mailhost!username@project.com",
	"user%example.com@project.com",
	"user-@project.com",
];

export const invalidEmails = [
	"abc.example.com",
	"a@b@c@example.com",
	'a"b(c)d,e:f;g<h>i[j\\k]l@example.com',
	'just"not"right@example.com',
	'this is"not\\allowed@example.com',
	'this\\ still\\"not\\\\allowed@example.com',
	"1234567890123456789012345678901234567890123456789012345678901234+x@example.com",
	"i.like.underscores@but_they_are_not_allowed_in_this_part",
	// No dot or a one-letter/numeric top-level domain: typos, not mailboxes.
	"d@t",
	"admin@example",
	"test@d.c",
	"person@example.c0m",
	// RFC-legal, but no provider issues quoted local parts or IP literals.
	'" "@example.org',
	'"john..doe"@example.org',
	"postmaster@[123.123.123.123]",
	"postmaster@[IPv6:2001:0db8:85a3:0000:0000:8a2e:0370:7334]",
	// Invisible characters would let two different addresses look the same.
	"per​son@example.com",
];
