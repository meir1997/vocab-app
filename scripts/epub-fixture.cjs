// Builds a tiny synthetic EPUB (ZIP) in memory for reader tests.
// No book content here: three short synthetic chapters only.
'use strict';
const zlib = require('node:zlib');

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipEntry(name, content, compress) {
  const nameBuf = Buffer.from(name, 'utf8');
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const payload = compress ? zlib.deflateRawSync(data) : data;
  const method = compress ? 8 : 0;
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 30); central.writeUInt32LE(0, 34);
  central.writeUInt32LE(0, 38);
  central.writeUInt32LE(0, 42); // local header offset patched by caller
  return { nameBuf, local, payload, central };
}

function buildZip(files) {
  const parts = []; const centrals = [];
  let offset = 0;
  for (const { name, content, compress } of files) {
    const e = zipEntry(name, content, compress);
    e.central.writeUInt32LE(offset, 42);
    parts.push(e.local, e.nameBuf, e.payload);
    centrals.push(Buffer.concat([e.central, e.nameBuf]));
    offset += e.local.length + e.nameBuf.length + e.payload.length;
  }
  const centralStart = offset;
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(centralStart, 16);
  return Buffer.concat([...parts, centralBuf, eocd]);
}

function buildTestEpub() {
  return buildZip([
    { name: 'mimetype', content: 'application/epub+zip' },
    { name: 'META-INF/container.xml', content: `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>` },
    { name: 'OEBPS/content.opf', content: `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Fixture Book</dc:title>
    <dc:creator>Fixture Author</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>` },
    { name: 'OEBPS/toc.ncx', content: `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <navMap>
    <navPoint id="n1"><navLabel><text>Beginning</text></navLabel><content src="ch1.xhtml"/></navPoint>
    <navPoint id="n2"><navLabel><text>Middle</text></navLabel><content src="ch2.xhtml"/></navPoint>
  </navMap>
</ncx>` },
    { name: 'OEBPS/ch1.xhtml', compress: true, content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Beginning</title><style>p{color:red}</style></head>
<body><h2>The Beginning</h2><p>A <b>small</b> chapter with <a href="ch2.xhtml">a link</a> and a possessive like harry&#8217;s.</p>
<script>alert('must not survive')</script><img src="x.jpg"/></body></html>` },
    { name: 'OEBPS/ch2.xhtml', content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Middle</title></head>
<body><h2>The Middle</h2><p>Second chapter text with <em>emphasis</em>.</p>
<iframe src="evil"></iframe><p>After the iframe.</p></body></html>` }
  ]);
}

// Variant with an image-only cover segment first in the spine, like real
// converted EPUBs: the reader must skip it on a fresh open.
function buildTestEpubWithCover() {
  return buildZip([
    { name: 'mimetype', content: 'application/epub+zip' },
    { name: 'META-INF/container.xml', content: `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>` },
    { name: 'OEBPS/content.opf', content: `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Covered Book</dc:title>
    <dc:creator>Fixture Author</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="ch2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="cover"/><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>` },
    { name: 'OEBPS/toc.ncx', content: `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <navMap>
    <navPoint id="n1"><navLabel><text>Beginning</text></navLabel><content src="ch1.xhtml"/></navPoint>
    <navPoint id="n2"><navLabel><text>Middle</text></navLabel><content src="ch2.xhtml"/></navPoint>
  </navMap>
</ncx>` },
    { name: 'OEBPS/cover.xhtml', content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Cover</title></head>
<body><div><img src="cover.jpg"/></div></body></html>` },
    { name: 'OEBPS/ch1.xhtml', compress: true, content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Beginning</title></head>
<body><h2>The Beginning</h2><p>A first chapter with enough real text to count as the readable opening of the book for a fresh reader.</p></body></html>` },
    { name: 'OEBPS/ch2.xhtml', content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Middle</title></head>
<body><h2>The Middle</h2><p>Second chapter text with <em>emphasis</em> and more words so this section is also comfortably readable.</p></body></html>` }
  ]);
}


// A single long chapter that spans many reader pages, for pagination tests.
function buildLongEpub() {
  const para = '<p>Chapter text that repeats to fill several pages of the paginated reader layout used in the tests.</p>';
  return buildZip([
    { name: 'mimetype', content: 'application/epub+zip' },
    { name: 'META-INF/container.xml', content: `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>` },
    { name: 'OEBPS/content.opf', content: `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Long Book</dc:title>
    <dc:creator>Fixture Author</dc:creator>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx"><itemref idref="ch1"/></spine>
</package>` },
    { name: 'OEBPS/toc.ncx', content: `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <navMap>
    <navPoint id="n1"><navLabel><text>Long</text></navLabel><content src="ch1.xhtml"/></navPoint>
  </navMap>
</ncx>` },
    { name: 'OEBPS/ch1.xhtml', compress: true, content: `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Long</title></head>
<body><h2>Long Chapter</h2>${para.repeat(160)}</body></html>` }
  ]);
}

module.exports = { buildZip, buildTestEpub, buildTestEpubWithCover, buildLongEpub, crc32 };
