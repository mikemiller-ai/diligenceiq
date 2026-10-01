import { SSMClient } from '@aws-sdk/client-ssm';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { createApp } from './app';
import { createKillSwitch } from './kill-switch';

// Module scope so the client and the kill-switch cache survive across warm invocations.
const app = createApp({
  killSwitch: createKillSwitch({
    ssm: new SSMClient({}),
    parameterName: process.env.KILL_SWITCH_PARAM,
  }),
});

export const handler = (event: APIGatewayProxyEventV2) => app(event);
