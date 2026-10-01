import { readFileSync } from 'node:fs';
import { App, type Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { buildApp } from '../lib/build-app';
import type { GuardTemplate } from '../lib/cost-guard';

/** The same feature flags `cdk synth` uses, so tests assert on what would deploy. */
export function cdkJsonContext(): Record<string, unknown> {
  const cdkJson = JSON.parse(readFileSync(new URL('../cdk.json', import.meta.url), 'utf8'));
  return cdkJson.context as Record<string, unknown>;
}

export function toGuardTemplates(stacks: readonly Stack[]): GuardTemplate[] {
  return stacks.map((s) => ({ stackName: s.stackName, template: Template.fromStack(s).toJSON() }));
}

/** Synthesizes every real stack once (this bundles the api Lambda with esbuild). */
export function synthAll() {
  const app = new App({ context: cdkJsonContext() });
  const stacks = buildApp(app);
  const templates = {
    core: Template.fromStack(stacks.core),
    api: Template.fromStack(stacks.api),
    web: Template.fromStack(stacks.web),
  };
  return { app, stacks, templates, guardInput: toGuardTemplates([stacks.core, stacks.api, stacks.web]) };
}
