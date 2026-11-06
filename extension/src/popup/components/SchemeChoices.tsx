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

// The schemes a safeguard can add once its signal is raised: not the one the signal breaks, and not one the wallet
// already requires (it would add nothing).
const backupChoices = (breaks: Scheme, schemes: Scheme[]) => SCHEMES.filter((c) => c !== breaks && !schemes.includes(c));

// The backups in effect with these schemes. The chosen backup, if it is still a choice; if it has become a scheme,
// the first backup that isn't one; and the safeguard off when none is left. So turning a scheme on and off again
// brings the chosen backup back, and a backup saved as a scheme too shows as a change to make.
export function effectiveSafeguards(safeguards: Safeguards, schemes: Scheme[]): Safeguards {
  return Object.fromEntries(
    SIGNALS.map((s) => {
      const key = s.address.toLowerCase();
      const chosen = safeguards[key] ?? null;
      const choices = backupChoices(s.breaks, schemes);
      return [key, chosen === null ? null : choices.includes(chosen) ? chosen : (choices[0] ?? null)];
    }),
  );
}

export const ruleChoices = (safeguards: Safeguards, schemes: Scheme[]): RuleChoice[] => {
  const effective = effectiveSafeguards(safeguards, schemes);
  return SIGNALS.flatMap((s) => {
    const backup = effective[s.address.toLowerCase()];
    return backup ? [{ signal: s.address, scheme: backup }] : [];
  });
};

// Whether the safeguards in effect with these schemes differ from the account's.
export function safeguardsChanged(account: Account | undefined, safeguards: Safeguards, schemes: Scheme[]): boolean {
  const saved = safeguardsOf(account);
  const effective = effectiveSafeguards(safeguards, schemes);
  return SIGNALS.some((s) => saved[s.address.toLowerCase()] !== effective[s.address.toLowerCase()]);
}

// Whether the chosen schemes and safeguards differ from the account's.
export function choicesChanged(account: Account | undefined, schemes: Scheme[], safeguards: Safeguards): boolean {
  const current = account?.schemes.map((s) => s.scheme) ?? [];
  return SCHEMES.some((s) => current.includes(s) !== schemes.includes(s)) || safeguardsChanged(account, safeguards, schemes);
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
  disabled = false,
}: {
  account: Account | undefined; // what's saved, for defaults and status
  schemes: Scheme[];
  onSchemes: (schemes: Scheme[]) => void;
  safeguards: Safeguards;
  onSafeguards: (safeguards: Safeguards) => void;
  signals: SignalStates;
  deployed: boolean | undefined;
  disabled?: boolean;
}) {
  const saved = safeguardsOf(account);
  const effective = effectiveSafeguards(safeguards, schemes);
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
          const backup = effective[key];
          const choices = backupChoices(s.breaks, schemes);
          // The saved backup if it's still a choice, or else the first choice.
          const savedBackup = saved[key];
          const fallback: Scheme | null = savedBackup && choices.includes(savedBackup) ? savedBackup : (choices[0] ?? null);
          const brokenAt = signals[key] ?? 0;
          const set = (scheme: Scheme | null) => onSafeguards({ ...safeguards, [key]: scheme });
          return (
            <div key={key} className="safeguard">
              <div className="toggle-row">
                {fallback !== null ? (
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
                ) : (
                  <span>{s.label}? Every other scheme is already required.</span>
                )}
                <input
                  type="checkbox"
                  className="switch"
                  checked={backup !== null}
                  disabled={disabled || fallback === null}
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
