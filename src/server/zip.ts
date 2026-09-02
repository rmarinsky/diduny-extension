import { once } from "node:events";
import type { Readable, Writable } from "node:stream";

export interface ZipEntry {
	modifiedAt?: number;
	name: string;
	source: Readable | Uint8Array;
}

type CentralDirectoryEntry = {
	checksum: number;
	modifiedAt: Date;
	name: Buffer;
	offset: number;
	size: number;
};

const zip32Maximum = 0xffff_ffff;
const crcTable = new Uint32Array(256);

for (let value = 0; value < crcTable.length; value += 1) {
	let current = value;
	for (let bit = 0; bit < 8; bit += 1) {
		current = current & 1 ? 0xedb8_8320 ^ (current >>> 1) : current >>> 1;
	}
	crcTable[value] = current >>> 0;
}

function crc32(checksum: number, bytes: Uint8Array) {
	let current = checksum;
	for (const byte of bytes) {
		current = (crcTable[(current ^ byte) & 0xff] ?? 0) ^ (current >>> 8);
	}
	return current >>> 0;
}

function dosTimestamp(value: Date) {
	const year = Math.max(value.getFullYear(), 1980);
	return {
		date:
			((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate(),
		time:
			(value.getHours() << 11) |
			(value.getMinutes() << 5) |
			(value.getSeconds() >> 1),
	};
}

function zipPath(name: string) {
	if (
		!name ||
		name.startsWith("/") ||
		name.split("/").some((part) => !part || part === "." || part === "..")
	) {
		throw new Error("unsafe ZIP entry name");
	}
	return Buffer.from(name, "utf8");
}

function localHeader(name: Buffer, modifiedAt: Date) {
	const { date, time } = dosTimestamp(modifiedAt);
	const header = Buffer.alloc(30);
	header.writeUInt32LE(0x0403_4b50, 0);
	header.writeUInt16LE(20, 4);
	header.writeUInt16LE(0x08, 6);
	header.writeUInt16LE(0, 8);
	header.writeUInt16LE(time, 10);
	header.writeUInt16LE(date, 12);
	header.writeUInt32LE(0, 14);
	header.writeUInt32LE(0, 18);
	header.writeUInt32LE(0, 22);
	header.writeUInt16LE(name.byteLength, 26);
	header.writeUInt16LE(0, 28);
	return Buffer.concat([header, name]);
}

function dataDescriptor(checksum: number, size: number) {
	const descriptor = Buffer.alloc(16);
	descriptor.writeUInt32LE(0x0807_4b50, 0);
	descriptor.writeUInt32LE(checksum, 4);
	descriptor.writeUInt32LE(size, 8);
	descriptor.writeUInt32LE(size, 12);
	return descriptor;
}

function centralHeader(entry: CentralDirectoryEntry) {
	const { date, time } = dosTimestamp(entry.modifiedAt);
	const header = Buffer.alloc(46);
	header.writeUInt32LE(0x0201_4b50, 0);
	header.writeUInt16LE(20, 4);
	header.writeUInt16LE(20, 6);
	header.writeUInt16LE(0x08, 8);
	header.writeUInt16LE(0, 10);
	header.writeUInt16LE(time, 12);
	header.writeUInt16LE(date, 14);
	header.writeUInt32LE(entry.checksum, 16);
	header.writeUInt32LE(entry.size, 20);
	header.writeUInt32LE(entry.size, 24);
	header.writeUInt16LE(entry.name.byteLength, 28);
	header.writeUInt16LE(0, 30);
	header.writeUInt16LE(0, 32);
	header.writeUInt16LE(0, 34);
	header.writeUInt16LE(0, 36);
	header.writeUInt32LE(0, 38);
	header.writeUInt32LE(entry.offset, 42);
	return Buffer.concat([header, entry.name]);
}

function endOfCentralDirectory(
	entryCount: number,
	centralSize: number,
	centralOffset: number,
) {
	const footer = Buffer.alloc(22);
	footer.writeUInt32LE(0x0605_4b50, 0);
	footer.writeUInt16LE(0, 4);
	footer.writeUInt16LE(0, 6);
	footer.writeUInt16LE(entryCount, 8);
	footer.writeUInt16LE(entryCount, 10);
	footer.writeUInt32LE(centralSize, 12);
	footer.writeUInt32LE(centralOffset, 16);
	footer.writeUInt16LE(0, 20);
	return footer;
}

async function write(output: Writable, bytes: Uint8Array) {
	if (!output.write(bytes)) await once(output, "drain");
}

async function* chunks(source: ZipEntry["source"]) {
	if (source instanceof Uint8Array) {
		yield source;
		return;
	}
	for await (const chunk of source) {
		if (typeof chunk === "string") yield Buffer.from(chunk);
		else yield chunk as Uint8Array;
	}
}

/**
 * Writes a ZIP32 archive directly to `output`. ZIP64 is the deliberate ceiling:
 * add it only when a personal library exceeds 4 GiB or 65,535 entries.
 */
export async function writeZip(
	output: Writable,
	entries: AsyncIterable<ZipEntry>,
) {
	const centralDirectory: CentralDirectoryEntry[] = [];
	let offset = 0;
	for await (const entry of entries) {
		if (centralDirectory.length >= 0xffff)
			throw new Error("library export has too many ZIP32 entries");
		if (offset > zip32Maximum)
			throw new Error("library export exceeds ZIP32 size");
		const name = zipPath(entry.name);
		const modifiedAt = new Date(entry.modifiedAt ?? Date.now());
		const header = localHeader(name, modifiedAt);
		await write(output, header);
		const entryOffset = offset;
		offset += header.byteLength;
		let checksum = 0xffff_ffff;
		let size = 0;
		for await (const chunk of chunks(entry.source)) {
			size += chunk.byteLength;
			if (size > zip32Maximum)
				throw new Error("library export entry exceeds ZIP32 size");
			checksum = crc32(checksum, chunk);
			await write(output, chunk);
			offset += chunk.byteLength;
		}
		const finalizedChecksum = (checksum ^ 0xffff_ffff) >>> 0;
		const descriptor = dataDescriptor(finalizedChecksum, size);
		await write(output, descriptor);
		offset += descriptor.byteLength;
		centralDirectory.push({
			checksum: finalizedChecksum,
			modifiedAt,
			name,
			offset: entryOffset,
			size,
		});
	}
	const centralOffset = offset;
	for (const entry of centralDirectory) {
		const header = centralHeader(entry);
		await write(output, header);
		offset += header.byteLength;
	}
	await write(
		output,
		endOfCentralDirectory(
			centralDirectory.length,
			offset - centralOffset,
			centralOffset,
		),
	);
	const finished = once(output, "finish");
	output.end();
	await finished;
}
