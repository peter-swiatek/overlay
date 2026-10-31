// Windows-1252 code points for bytes 0x80..0x9F (0 = undefined in the standard). Node's
// TextDecoder("windows-1252") returns plain Latin-1 there (C1 controls), so we map them ourselves.
const CP1252_HIGH = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152,
  0, 0x017d, 0, 0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161,
  0x203a, 0x0153, 0, 0x017e, 0x0178,
];

const UTF8_STRICT = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function decodeCp1252(bytes: Uint8Array): string {
  const parts: string[] = [];
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    const codes = Array.from(bytes.subarray(i, i + chunk), (b) =>
      b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80] || b : b,
    );
    parts.push(String.fromCharCode(...codes));
  }
  return parts.join("");
}

/**
 * Text the sims write into shared memory: cut at the first NUL, then UTF-8 if the bytes are
 * valid UTF-8 (LMU writes UTF-8), otherwise Windows-1252 (iRacing writes ANSI).
 */
export function decodeSimText(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  const used = end < 0 ? bytes : bytes.subarray(0, end);
  try {
    return UTF8_STRICT.decode(used);
  } catch {
    return decodeCp1252(used);
  }
}

/**
 * Multi-line text (the iRacing session YAML) where different lines may use different encodings
 * (one driver's name arrives as UTF-8, another's as Windows-1252): cut at the first NUL, then
 * apply the UTF-8-else-Windows-1252 rule to each line on its own.
 */
export function decodeSimLines(bytes: Uint8Array): string {
  const end = bytes.indexOf(0);
  const used = end < 0 ? bytes : bytes.subarray(0, end);
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i <= used.length; i++) {
    if (i === used.length || used[i] === 0x0a) {
      lines.push(decodeSimText(used.subarray(start, i)));
      start = i + 1;
    }
  }
  return lines.join("\n");
}
