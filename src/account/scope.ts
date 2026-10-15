// The organization and team every scoped command runs in. They are the
// CLI's own choice, saved by `lace org use` and `lace team use` and read by
// `lace org current` and `lace team current`, so a terminal and the
// extension always agree; the extension keeps neither.
//
// Each pick is on screen from the moment it is asked for and fills when its
// read settles (`vscode/pick.ts`). Choosing an organization goes on to
// choosing its team: the team pick opens as the organization is saved, and
// the team is listed and saved in the organization just chosen, named by
// `--org`, so the saved team belongs to it even while the engine's
// environment sets another organization. An organization with no team has
// nothing to pick from; teams are created in the portal, on the page
// `lace team list` names (`createUrl`), which Open Portal opens.
import type { CommandsPort, JsonOf } from '@lace-cloud/canvas/engine';
import type * as vscode from 'vscode';
import { commandDocument } from '../engine/command-outcome';
import { LACE_COMMANDS } from '../engine/lace-commands';
import { OFFER_LABELS } from '../vscode/offers';
import { pickFrom } from '../vscode/pick';

export type ScopeApi = {
  window: Pick<typeof vscode.window, 'createQuickPick' | 'showInformationMessage'>;
  env: { openExternal: (uri: vscode.Uri) => Thenable<boolean> };
  Uri: Pick<typeof vscode.Uri, 'parse'>;
};

type Current = JsonOf<'org current'>;
type Noun = 'organization' | 'team';

const asking = (noun: Noun): string => `Select a Lace ${noun}`;

// What the pick says about the selection the command reports. With the
// selection set by the engine's environment, a saved choice does not apply
// until that variable is unset.
function placeholder(noun: Noun, current: Current): string {
  return current.source === 'env'
    ? `The Lace engine's environment sets the ${noun}; the choice made here is saved and applies once that variable is unset`
    : asking(noun);
}

const described = (slug: string, current: Current): string =>
  slug === current.slug ? `${slug} · current` : slug;

// The teams `lace team list` lists in `scope`, and the one `lace team
// current` reports there.
const teamsIn = (commands: CommandsPort, scope: { org?: string }) =>
  Promise.all([
    commandDocument(commands, LACE_COMMANDS['team list'], scope),
    commandDocument(commands, LACE_COMMANDS['team current'], scope),
  ]);

// Picks an organization from `lace org list`, saves it with `lace org use`
// and goes on to its team. Resolves true when a choice was saved.
export async function selectOrganization(commands: CommandsPort, api: ScopeApi): Promise<boolean> {
  const listed = Promise.all([
    commandDocument(commands, LACE_COMMANDS['org list'], {}),
    commandDocument(commands, LACE_COMMANDS['org current'], {}),
  ]);
  const picked = await pickFrom(
    api.window,
    listed.then(([organizations, current]) => ({
      items: organizations.items.map((organization) => ({
        label: organization.name,
        description: described(organization.slug, current),
        detail: organization.role,
        slug: organization.slug,
      })),
      placeholder: placeholder('organization', current),
      none: () =>
        void api.window.showInformationMessage(
          'Your Lace account belongs to no organization yet. Organizations are created in the portal.',
        ),
    })),
    { placeholder: asking('organization') },
  );
  if (!picked) return false;
  const scope = { org: picked.slug };
  const saved = commandDocument(commands, LACE_COMMANDS['org use'], scope);
  await pickTeam(
    commands,
    api,
    scope,
    saved.then(() => teamsIn(commands, scope)),
  );
  await saved;
  return true;
}

// Picks a team of the current organization and saves it. Resolves true when
// a choice was saved.
export const selectTeam = (commands: CommandsPort, api: ScopeApi): Promise<boolean> =>
  pickTeam(commands, api, {}, teamsIn(commands, {}));

// Picks a team from `listed` and saves it with `lace team use` in the
// organization `scope` names, else the current one.
async function pickTeam(
  commands: CommandsPort,
  api: ScopeApi,
  scope: { org?: string },
  listed: ReturnType<typeof teamsIn>,
): Promise<boolean> {
  const picked = await pickFrom(
    api.window,
    listed.then(([teams, current]) => ({
      items: teams.items.map((team) => ({
        label: team.name,
        description: described(team.slug, current),
        detail: team.description,
        slug: team.slug,
      })),
      placeholder: placeholder('team', current),
      none: () =>
        void api.window
          .showInformationMessage(
            'This organization has no team yet. Teams are created in the portal.',
            OFFER_LABELS.openPortal,
          )
          .then((answer) =>
            answer === OFFER_LABELS.openPortal
              ? api.env.openExternal(api.Uri.parse(teams.createUrl))
              : undefined,
          ),
    })),
    { placeholder: asking('team') },
  );
  if (!picked) return false;
  await commandDocument(commands, LACE_COMMANDS['team use'], { team: picked.slug, ...scope });
  return true;
}

export type Selection = { organization: Current; team: Current };

export async function currentSelection(commands: CommandsPort): Promise<Selection> {
  const [organization, team] = await Promise.all([
    commandDocument(commands, LACE_COMMANDS['org current'], {}),
    commandDocument(commands, LACE_COMMANDS['team current'], {}),
  ]);
  return { organization, team };
}

const SOURCES: Readonly<Record<NonNullable<Current['source']>, string>> = {
  config: 'saved by lace org use or lace team use',
  env: "set by the Lace engine's environment",
  flag: 'set by a flag',
};

// The status bar's text and tooltip for a selection.
export function selectionStatus(selection: Selection): { text: string; tooltip: string } {
  const { organization, team } = selection;
  const line = (noun: string, current: Current) =>
    current.slug === null
      ? `No ${noun} selected`
      : `${noun[0].toUpperCase()}${noun.slice(1)}: ${current.slug} (${SOURCES[current.source]})`;
  const text =
    organization.slug === null
      ? '$(organization) No Lace organization'
      : `$(organization) ${organization.slug}${team.slug === null ? '' : ` · ${team.slug}`}`;
  return { text, tooltip: [line('organization', organization), line('team', team)].join('\n') };
}
