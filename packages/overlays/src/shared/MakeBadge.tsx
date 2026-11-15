import { CAR_MAKES } from "@overlay/sim-core/pure";
import { resolveLogo, type RowTone } from "./make-logos";
import { flagUrl } from "./nationality-flags";

/**
 * The manufacturer cell: the make's logo (the user's own file, else the bundled one in the
 * variant for the row's tone), or the make's short text code when there is no logo. Empty for
 * an unknown make.
 */
export function MakeBadge({
  make,
  tone,
  overrides,
}: {
  make: string | null;
  tone: RowTone;
  overrides?: Readonly<Record<string, string>>;
}): JSX.Element | null {
  if (make === null) return null;
  const name = CAR_MAKES[make]?.name ?? make;
  const logo = resolveLogo(make, tone, overrides);
  if (logo === null) {
    const code = CAR_MAKES[make]?.code ?? make.slice(0, 3).toUpperCase();
    return (
      <span className="ov-make-code" title={name}>
        {code}
      </span>
    );
  }
  return (
    <img
      className={logo.chip ? "ov-make-logo ov-make-logo--chip" : "ov-make-logo"}
      src={logo.src}
      alt={name}
      title={name}
      draggable={false}
    />
  );
}

/** The nationality cell: the country's flag; empty when the code is unknown. */
export function NationalityFlag({ code }: { code: string | null }): JSX.Element | null {
  const src = flagUrl(code);
  if (src === null || code === null) return null;
  const label = code.toUpperCase();
  return <img className="ov-flag" src={src} alt={label} title={label} draggable={false} />;
}
