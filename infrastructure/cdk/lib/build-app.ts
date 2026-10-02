import type { App } from 'aws-cdk-lib';
import { ApiStack } from './api-stack';
import { CONFIG, TAGS } from './config';
import { CoreStack } from './core-stack';
import { WebStack } from './web-stack';
import { WorkerStack } from './worker-stack';

/** Adds every stack to `app`. Shared by bin/app.ts and the assertion tests. */
export function buildApp(app: App) {
  const env = { account: CONFIG.account, region: CONFIG.region };
  // Stack-level tags (explicitStackTags flag); CloudFormation propagates them to resources.
  const common = { env, tags: { ...TAGS } };

  const core = new CoreStack(app, CONFIG.stackNames.core, { ...common, stackName: CONFIG.stackNames.core });
  // The worker plane first: the api sends to its queue.
  const worker = new WorkerStack(app, CONFIG.stackNames.worker, {
    ...common,
    stackName: CONFIG.stackNames.worker,
    table: core.table,
    dataBucket: core.dataBucket,
    killSwitch: core.killSwitch,
  });
  const api = new ApiStack(app, CONFIG.stackNames.api, {
    ...common,
    stackName: CONFIG.stackNames.api,
    table: core.table,
    dataBucket: core.dataBucket,
    killSwitch: core.killSwitch,
    activeProfileSet: core.activeProfileSet,
    queue: worker.queue,
  });
  const web = new WebStack(app, CONFIG.stackNames.web, {
    ...common,
    stackName: CONFIG.stackNames.web,
    apiEndpoint: api.apiEndpoint,
  });
  return { core, api, web, worker };
}
