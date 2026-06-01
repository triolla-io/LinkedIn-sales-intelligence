import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createWriteStream } from "fs";
import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";

// Zip the extension/dist folder and serve it for download.
// Uses only Node built-ins — no extra dependencies.

async function collectFiles(dir: string, base: string): Promise<Array<{ path: string; data: Buffer }>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: Array<{ path: string; data: Buffer }> = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(full, rel));
    } else {
      files.push({ path: rel, data: await readFile(full) });
    }
  }
  return files;
}

// Minimal ZIP builder (no compression — store only, works fine for small extensions)
function buildZip(files: Array<{ path: string; data: Buffer }>): Buffer {
  const localHeaders: Buffer[] = [];
  const centralDirs: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.path.replace(/\\/g, "/"));
    const data = file.data;
    const crc = crc32(data);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);  // signature
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(0, 8);           // compression (store)
    local.writeUInt16LE(0, 10);          // mod time
    local.writeUInt16LE(0, 12);          // mod date
    local.writeUInt32LE(crc, 14);        // crc32
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(name.length, 26); // name length
    local.writeUInt16LE(0, 28);          // extra length
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0); // signature
    central.writeUInt16LE(20, 4);         // version made by
    central.writeUInt16LE(20, 6);         // version needed
    central.writeUInt16LE(0, 8);          // flags
    central.writeUInt16LE(0, 10);         // compression
    central.writeUInt16LE(0, 12);         // mod time
    central.writeUInt16LE(0, 14);         // mod date
    central.writeUInt32LE(crc, 16);       // crc32
    central.writeUInt32LE(data.length, 20); // compressed size
    central.writeUInt32LE(data.length, 24); // uncompressed size
    central.writeUInt16LE(name.length, 28); // name length
    central.writeUInt16LE(0, 30);         // extra length
    central.writeUInt16LE(0, 32);         // comment length
    central.writeUInt16LE(0, 34);         // disk number start
    central.writeUInt16LE(0, 36);         // int file attrs
    central.writeUInt32LE(0, 38);         // ext file attrs
    central.writeUInt32LE(offset, 42);    // local header offset
    name.copy(central, 46);

    offset += local.length + data.length;
    localHeaders.push(local, data);
    centralDirs.push(central);
  }

  const centralStart = offset;
  const centralSize = centralDirs.reduce((s, b) => s + b.length, 0);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);   // end of central dir signature
  eocd.writeUInt16LE(0, 4);            // disk number
  eocd.writeUInt16LE(0, 6);            // disk with central dir
  eocd.writeUInt16LE(files.length, 8); // entries on this disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(centralSize, 12); // size of central dir
  eocd.writeUInt32LE(centralStart, 16); // offset of central dir
  eocd.writeUInt16LE(0, 20);           // comment length

  return Buffer.concat([...localHeaders, ...centralDirs, eocd]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export async function GET(req: NextRequest): Promise<Response> {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const distDir = path.join(process.cwd(), "extension", "dist");
  try {
    await stat(distDir);
  } catch {
    return NextResponse.json({ error: "Extension not built" }, { status: 404 });
  }

  const files = await collectFiles(distDir, "triolla-linkedin-sender");
  const zip = buildZip(files);

  return new Response(zip.buffer as ArrayBuffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="triolla-linkedin-sender.zip"',
      "Content-Length": String(zip.length),
    },
  });
}
