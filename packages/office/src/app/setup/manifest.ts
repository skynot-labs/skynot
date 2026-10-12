export const APP_PERMISSIONS = {
  contents: "write",
  issues: "write",
  pull_requests: "write",
  actions: "read",
  metadata: "read",
} as const;

const MAX_APP_NAME = 34;

export interface AppManifest {
  readonly name: string;
  readonly url: string;
  readonly description: string;
  readonly redirect_url: string;
  readonly public: false;
  readonly default_permissions: typeof APP_PERMISSIONS;
}

// No hook_attributes and no default_events: the service polls GitHub and has no webhook receiver.
export function appManifest(name: string, redirectUrl: string): AppManifest {
  return {
    name,
    url: "https://github.com/skynot-labs/skynot",
    description: "The identity a skynot shop opens issues, branches and pull requests under.",
    redirect_url: redirectUrl,
    public: false,
    default_permissions: APP_PERMISSIONS,
  };
}

export const appName = (owner: string | null): string => (owner ? `skynot-${owner}` : "skynot-shop").slice(0, MAX_APP_NAME);

const ORGANIZATION = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

export const isOrganizationName = (name: string): boolean => ORGANIZATION.test(name);

export const appsSettingsUrl = (organization: string | null): string =>
  organization ? `https://github.com/organizations/${organization}/settings/apps` : "https://github.com/settings/apps";

export const manifestTarget = (organization: string | null, state: string): string => `${appsSettingsUrl(organization)}/new?state=${encodeURIComponent(state)}`;

export const deleteAppUrl = (organization: string | null, slug: string): string => `${appsSettingsUrl(organization)}/${slug}/advanced`;
