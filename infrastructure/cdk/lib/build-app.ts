import type { App } from 'aws-cdk-lib';
import { ApiStack } from './api-stack';
import { CONFIG, TAGS } from './config';
import { CoreStack } from './core-stack';
import { WebStack } from './web-stack';

/** Adds every stack to `app`. Shared by bin/app.ts and the assertion tests. */
export function buildApp(app: App) {
  const env = { account: CONFIG.account, region: CONFIG.region };
  // Stack-level tags (explicitStackTags flag); CloudFormation propagates them to resources.
  const common = { env, tags: { ...TAGS } };

  const core = new CoreStack(app, CONFIG.stackNames.core, { ...common, stackName: CONFIG.stackNames.core });
  const api = new ApiStack(app, CONFIG.stackNames.api, {
    ...common,
    stackName: CONFIG.stackNames.api,
    table: core.table,
    killSwitch: core.killSwitch,
  });
  const web = new WebStack(app, CONFIG.stackNames.web, {
    ...common,
    stackName: CONFIG.stackNames.web,
    apiEndpoint: api.apiEndpoint,
  });
  return { core, api, web };
}
