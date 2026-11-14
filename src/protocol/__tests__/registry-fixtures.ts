// Registry documents as the CLI's `-o json` prints them, for the registry's
// host and page tests.
import type { ModuleInterface, RegistryRecord, RegistryRow } from '../registry-protocol';

export function row(over: Partial<RegistryRow> = {}): RegistryRow {
  return {
    id: 'man_2',
    axis: 'module',
    author: 'acme',
    name: 'vpc',
    displayName: 'ACME VPC',
    version: 'v2.0.0',
    status: 'published',
    visibility: 'public',
    description: 'A VPC module',
    categories: ['networking'],
    authorProfile: null,
    system: 'aws',
    sourceAddress: 'lace.cloud/acme/vpc/aws',
    publisherVerdict: 'lace',
    ...over,
  };
}

export const LOGO = 'https://acme.example/logo.svg';

export const authorProfile = (logoUrl: string | null): RegistryRow['authorProfile'] => ({
  author: 'acme',
  displayName: 'ACME Corp',
  logoUrl,
  description: null,
  homepageUrl: null,
  supportEmail: null,
  verified: true,
});

export const GUIDE = 'https://portal.example/docs/registry-publishing';

export const list = (items: RegistryRow[], truncated = false) => ({
  items,
  truncated,
  publishingGuideUrl: GUIDE,
});

// A version as `registry get` lists it.
export const versionEntry = (
  version: string,
  status: string,
): RegistryRecord['versions'][number] => ({
  version,
  status,
  publishedAt: '2026-09-30T10:00:00Z',
});

export function record(
  over: {
    readme?: string | null;
    versions?: string[];
    // The versions of `versions` the registry has deprecated.
    deprecated?: string[];
    // The version the registry names as latest, and its status.
    latest?: { version: string; status: string };
  } = {},
): RegistryRecord {
  const latest = row(over.latest);
  return {
    axis: 'module',
    author: latest.author,
    name: latest.name,
    treeHash: 'h',
    repo: '',
    commit: '',
    latest: {
      id: latest.id,
      axis: 'module',
      provider: null,
      author: latest.author,
      name: latest.name,
      version: latest.version,
      orgId: null,
      visibility: 'public',
      ownership: 'vendor',
      displayName: latest.displayName,
      description: latest.description,
      categories: latest.categories,
      readme: over.readme ?? null,
      authorProfile: null,
      status: latest.status,
      publishedAt: '2026-09-30T10:00:00Z',
      publishedBy: null,
      createdAt: '2026-09-30T10:00:00Z',
      updatedAt: '2026-09-30T10:00:00Z',
      system: 'aws',
      sourceAddress: latest.sourceAddress,
      sourceVersion: latest.version,
      treeHash: 'h',
      publisherVerdict: 'lace',
      publisherModules: null,
      attestedAt: null,
      repository: null,
      commit: null,
    },
    versions: (over.versions ?? ['v2.0.0', 'v1.1.0', 'v1.0.0']).map((version) =>
      versionEntry(version, over.deprecated?.includes(version) ? 'deprecated' : 'published'),
    ),
  };
}

export const described: ModuleInterface = {
  author: 'acme',
  name: 'vpc',
  version: 'v2.0.0',
  source: 'lace.cloud/acme/vpc/aws',
  treeHash: 'h',
  verdict: 'already-lace-style',
  interface: {
    inputs: [
      {
        name: 'cidr',
        type: 'string',
        required: true,
        description: 'The VPC range',
        default: null,
        sensitive: false,
      },
    ],
    outputs: [{ name: 'vpc_id', description: 'The VPC', sensitive: false }],
  },
};
