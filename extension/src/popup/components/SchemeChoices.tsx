import { SchemeChip } from "./SchemeChip";
import { SCHEMES, SCHEME_INFO, type Scheme } from "../schemes";
import type { Account, SignalStates } from "../../wallet/account";
import { SIGNALS } from "../../wallet/network";
import type { RuleChoice } from "../../wallet/transaction";

// Each known signal's chosen backup scheme, or null when its safeguard is off, by lowercase signal address.
export type Safeguards = Record<string, Scheme | null>;

export const safeguardsOf = (account: Account | undefined): Safeguards =>
  Object.fromEntries(
    SIGNALS.map((s) => [s.address.toLowerCase(), account?.rules?.find((r) => r.signal.toLowerCase() === s.address.toLowerCase())?.scheme ?? null]),
  );

export const ruleChoices = (safeguards: Safeguards): RuleChoice[] =>
  SIGNALS.flatMap((s) => {
    const backup = safeguards[s.address.toLowerCase()];
    return backup ? [{ signal: s.address, scheme: backup }] : [];
  });

// Whether the chosen safeguards differ from the account's.
export function safeguardsChanged(account: Account | undefined, safeguards: Safeguards): boolean {
  const saved = safeguardsOf(account);
  return SIGNALS.some((s) => saved[s.address.toLowerCase()] !== safeguards[s.address.toLowerCase()]);
}

// Whether the chosen schemes and safeguards differ from the account's.
export function choicesChanged(account: Account | undefined, schemes: Scheme[], safeguards: Safeguards): boolean {
  const current = account?.schemes.map((s) => s.scheme) ?? [];
  return SCHEMES.some((s) => current.includes(s) !== schemes.includes(s)) || safeguardsChanged(account, safeguards);
}

// The scheme switches and the safeguards: which signatures every transaction needs, and which backup each known
// signal adds once it is raised. Used to change a deployed wallet's, and to choose an undeployed wallet's.
export function SchemeChoices({
  account,
  schemes,
  onSchemes,
  safeguards,
  onSafeguards,
  signals,
  deployed,
  disabled,
}: {
  account: Account | undefined; // what's saved, for defaults and status
  schemes: Scheme[];
  onSchemes: (schemes: Scheme[]) => void;
  safeguards: Safeguards;
  onSafeguards: (safeguards: Safeguards) => void;
  signals: SignalStates;
  deployed: boolean | undefined;
  disabled: boolean;
}) {
  const saved = safeguardsOf(account);
  const toggle = (s: Scheme) => onSchemes(schemes.includes(s) ? schemes.filter((x) => x !== s) : [...schemes, s]);
  return (
    <>
      <div>
        {SCHEMES.map((s) => (
          <label key={s} className="toggle-row">
            <SchemeChip scheme={s} />
            <input type="checkbox" className="switch" checked={schemes.includes(s)} disabled={disabled} onChange={() => toggle(s)} />
          </label>
        ))}
      </div>
      <div>
        <p className="label">Safeguards</p>
        {SIGNALS.map((s) => {
          const key = s.address.toLowerCase();
          const backup = safeguards[key];
          const choices = SCHEMES.filter((c) => c !== s.breaks);
          // The saved backup, or else one that isn't a chosen scheme (a backup that is adds nothing).
          const fallback = saved[key] ?? choices.find((c) => !schemes.includes(c)) ?? choices[choices.length - 1];
          const brokenAt = signals[key] ?? 0;
          const set = (scheme: Scheme | null) => onSafeguards({ ...safeguards, [key]: scheme });
          return (
            <div key={key} className="safeguard">
              <div className="toggle-row">
                <span>
                  {s.label}? Also require{" "}
                  <select
                    className="select"
                    aria-label="Backup scheme"
                    value={backup ?? fallback}
                    disabled={disabled || backup === null}
                    onChange={(e) => set(e.target.value as Scheme)}
                  >
                    {choices.map((c) => (
                      <option key={c} value={c}>
                        {SCHEME_INFO[c].label}
                      </option>
                    ))}
                  </select>
                </span>
                <input
                  type="checkbox"
                  className="switch"
                  checked={backup !== null}
                  disabled={disabled}
                  onChange={() => set(backup === null ? fallback : null)}
                  aria-label={`Require a backup if ${s.label}`}
                />
              </div>
              <p className="hint">
                {deployed === undefined
                  ? ""
                  : brokenAt === 0
                    ? "Not signalled."
                    : `Signalled ${new Date(brokenAt * 1000).toLocaleDateString(undefined, { dateStyle: "medium" })}` +
                      (deployed && saved[key] ? ` · ${SCHEME_INFO[saved[key]!].label} now required.` : ".")}
              </p>
            </div>
          );
        })}
      </div>
    </>
  );
}
