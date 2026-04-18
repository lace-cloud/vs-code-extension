import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  buildProjectProfile,
  detectCloudHints,
  detectDatabases,
  detectExistingModules,
  detectFrameworks,
  detectLanguages,
  detectRuntimes,
} from '../host/tools/workspace-tools';

vi.mock('vscode', async () => {
  const { createVscodeMock } = await import('./test-utils/vscode-mock');
  return createVscodeMock();
});

// ── Pure helpers ──

describe('detectLanguages', () => {
  test('package.json → typescript/javascript', () => {
    expect(detectLanguages(new Set(['package.json']))).toEqual(['typescript/javascript']);
  });
  test('go.mod → go', () => {
    expect(detectLanguages(new Set(['go.mod']))).toEqual(['go']);
  });
  test('python triggers from either requirements.txt or pyproject.toml', () => {
    expect(detectLanguages(new Set(['requirements.txt']))).toContain('python');
    expect(detectLanguages(new Set(['pyproject.toml']))).toContain('python');
  });
  test('java triggers from either pom.xml or build.gradle', () => {
    expect(detectLanguages(new Set(['pom.xml']))).toContain('java');
    expect(detectLanguages(new Set(['build.gradle']))).toContain('java');
  });
  test('multi-language project lists each detected', () => {
    const langs = detectLanguages(new Set(['package.json', 'go.mod', 'Cargo.toml', 'Gemfile']));
    expect(langs).toEqual(expect.arrayContaining(['typescript/javascript', 'go', 'rust', 'ruby']));
  });
  test('empty input → empty list', () => {
    expect(detectLanguages(new Set())).toEqual([]);
  });
});

describe('detectFrameworks', () => {
  test('parses package.json deps + devDependencies', () => {
    const pkg = JSON.stringify({
      dependencies: { express: '*', react: '*' },
      devDependencies: { fastify: '*' },
    });
    const frameworks = detectFrameworks(new Map([['package.json', pkg]]));
    expect(frameworks).toEqual(expect.arrayContaining(['express', 'fastify', 'react']));
  });

  test('next short-circuits react detection (next ships React)', () => {
    const pkg = JSON.stringify({ dependencies: { next: '*', react: '*' } });
    const frameworks = detectFrameworks(new Map([['package.json', pkg]]));
    expect(frameworks).toContain('next.js');
    expect(frameworks).not.toContain('react');
  });

  test('malformed package.json is silently skipped (no throw)', () => {
    const frameworks = detectFrameworks(new Map([['package.json', '{ not valid json']]));
    expect(frameworks).toEqual([]);
  });

  test('python frameworks from requirements.txt regex', () => {
    const reqs = 'django==4.2\nfastapi>=0.100';
    const frameworks = detectFrameworks(new Map([['requirements.txt', reqs]]));
    expect(frameworks).toEqual(expect.arrayContaining(['django', 'fastapi']));
  });

  test('go frameworks from go.mod regex', () => {
    const gomod =
      'require github.com/gin-gonic/gin v1.9.0\nrequire github.com/gofiber/fiber v2.0.0';
    const frameworks = detectFrameworks(new Map([['go.mod', gomod]]));
    expect(frameworks).toEqual(expect.arrayContaining(['gin', 'fiber']));
  });

  test('returns [] when no recognised inputs present', () => {
    expect(detectFrameworks(new Map())).toEqual([]);
  });
});

describe('detectRuntimes', () => {
  test('Dockerfile FROM line picked up', () => {
    const docker = 'FROM node:20-alpine\nWORKDIR /app';
    expect(detectRuntimes(new Map([['Dockerfile', docker]]))).toEqual(['node:20-alpine']);
  });

  test('docker-compose.yml is the FROM fallback when Dockerfile missing', () => {
    const compose = 'FROM python:3.11\n# ...';
    expect(detectRuntimes(new Map([['docker-compose.yml', compose]]))).toEqual(['python:3.11']);
  });

  test('package.json engines.node prepends node:', () => {
    const pkg = JSON.stringify({ engines: { node: '>=20' } });
    expect(detectRuntimes(new Map([['package.json', pkg]]))).toEqual(['node:>=20']);
  });

  test('combines Dockerfile + engines.node', () => {
    const docker = 'FROM golang:1.22\n';
    const pkg = JSON.stringify({ engines: { node: '20.x' } });
    expect(
      detectRuntimes(
        new Map([
          ['Dockerfile', docker],
          ['package.json', pkg],
        ]),
      ),
    ).toEqual(['golang:1.22', 'node:20.x']);
  });

  test('Dockerfile without FROM yields nothing', () => {
    expect(detectRuntimes(new Map([['Dockerfile', '# no FROM here\n']]))).toEqual([]);
  });
});

describe('detectDatabases', () => {
  test('postgres detected from package.json psycopg/pg references', () => {
    const fc = new Map([['package.json', JSON.stringify({ dependencies: { pg: '*' } })]]);
    expect(detectDatabases(fc)).toContain('postgres');
  });
  test('multiple databases detected, deduplicated', () => {
    const fc = new Map([
      ['Dockerfile', 'FROM redis\nFROM mongodb'],
      ['package.json', '{"dependencies":{"redis":"*","mongoose":"*"}}'],
    ]);
    const dbs = detectDatabases(fc);
    expect(dbs).toEqual(expect.arrayContaining(['redis', 'mongodb']));
    expect(new Set(dbs).size).toBe(dbs.length); // deduplicated
  });
  test('no matches → empty list', () => {
    expect(detectDatabases(new Map([['README.md', 'some prose']]))).toEqual([]);
  });
});

describe('detectCloudHints', () => {
  test('aws detected via @aws-sdk import', () => {
    const fc = new Map([['package.json', '{"dependencies":{"@aws-sdk/client-s3":"*"}}']]);
    expect(detectCloudHints(fc)).toContain('aws');
  });
  test('azure + google both detected when present', () => {
    const fc = new Map([
      ['package.json', '{"dependencies":{"@azure/identity":"*","@google-cloud/storage":"*"}}'],
    ]);
    expect(detectCloudHints(fc)).toEqual(expect.arrayContaining(['azure', 'google']));
  });
  test('aws_-prefixed Terraform vars also count as aws hint', () => {
    const fc = new Map([['main.tf', 'resource "aws_s3_bucket" "x" { bucket = aws_account_id }']]);
    expect(detectCloudHints(fc)).toContain('aws');
  });
});

// ── fs-touching helper ──

describe('detectExistingModules', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'lace-workspace-tools-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('reads .lace/main.tf and extracts source = "..." entries', () => {
    const laceDir = join(tmpRoot, '.lace');
    mkdirSync(laceDir);
    writeFileSync(
      join(laceDir, 'main.tf'),
      [
        'module "vpc" {',
        '  source  = "terraform-aws-modules/vpc/aws"',
        '  version = "5.0"',
        '}',
        'module "iam" {',
        '  source = "../local-iam"',
        '}',
      ].join('\n'),
    );

    expect(detectExistingModules(tmpRoot)).toEqual([
      'terraform-aws-modules/vpc/aws',
      '../local-iam',
    ]);
  });

  test('returns [] when .lace/ does not exist', () => {
    expect(detectExistingModules(tmpRoot)).toEqual([]);
  });

  test('returns [] when .lace/main.tf is missing (e.g. only state.lace exists)', () => {
    mkdirSync(join(tmpRoot, '.lace'));
    expect(detectExistingModules(tmpRoot)).toEqual([]);
  });
});

// ── Composition ──

describe('buildProjectProfile', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'lace-workspace-profile-'));
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('composes detection helpers + fs read', () => {
    // Set up an .lace/main.tf so existing_modules is non-empty.
    const laceDir = join(tmpRoot, '.lace');
    mkdirSync(laceDir);
    writeFileSync(join(laceDir, 'main.tf'), 'module "vpc" { source = "aws-modules/vpc" }');

    const profile = buildProjectProfile(
      tmpRoot,
      new Set(['package.json', 'Dockerfile']),
      new Map([
        ['package.json', '{"dependencies":{"express":"*"},"engines":{"node":">=18"}}'],
        ['Dockerfile', 'FROM node:20\n'],
      ]),
    );

    expect(profile).toEqual({
      languages: ['typescript/javascript'],
      frameworks: ['express'],
      runtimes: ['node:20', 'node:>=18'],
      databases: [],
      cloud_hints: [],
      existing_modules: ['aws-modules/vpc'],
    });
  });

  test('empty workspace yields all-empty profile', () => {
    expect(buildProjectProfile(tmpRoot, new Set(), new Map())).toEqual({
      languages: [],
      frameworks: [],
      runtimes: [],
      databases: [],
      cloud_hints: [],
      existing_modules: [],
    });
  });
});
