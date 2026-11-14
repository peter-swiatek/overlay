import { compositeOver, contrastOfRgb, overBlack } from "@overlay/theme";
import type { ThemeTokenKey, ThemeTokens } from "@overlay/theme/types";

export interface ContrastWarning {
  token: ThemeTokenKey;
  against: ThemeTokenKey;
  ratio: number;
  needed: number;
  message: string;
}

const PLACE: Partial<Record<ThemeTokenKey, string>> = {
  row: "the row",
  rowAlt: "the alternate row",
  header: "the header",
  ownRow: "the own row",
};
const LABEL: Partial<Record<ThemeTokenKey, string>> = { text: "Text", textMuted: "Muted text" };

const CHECKS: readonly { token: "text" | "textMuted"; against: ThemeTokenKey; needed: number }[] = [
  { token: "text", against: "row", needed: 4.5 },
  { token: "text", against: "rowAlt", needed: 4.5 },
  { token: "text", against: "header", needed: 4.5 },
  { token: "textMuted", against: "row", needed: 3 },
  { token: "textMuted", against: "header", needed: 3 },
  { token: "text", against: "ownRow", needed: 4.5 },
];

/**
 * Backgrounds are drawn over the tint, which is drawn over the sim image (unknown, so black);
 * text colours are composited over the resulting background. Warnings never block saving.
 */
export function contrastWarnings(tokens: ThemeTokens): ContrastWarning[] {
  const tint = overBlack(tokens.backgroundTint);
  if (!tint) return [];
  const out: ContrastWarning[] = [];
  for (const { token, against, needed } of CHECKS) {
    const bg = compositeOver(tokens[against], tint);
    const fg = bg && compositeOver(tokens[token], bg);
    if (!bg || !fg) continue;
    const ratio = contrastOfRgb(fg, bg);
    if (ratio >= needed) continue;
    out.push({
      token,
      against,
      ratio,
      needed,
      message: `${LABEL[token]} on ${PLACE[against]} is ${ratio.toFixed(1)}:1; aim for at least ${needed}:1.`,
    });
  }
  return out;
}
