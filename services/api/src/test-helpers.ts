import type { APIGatewayProxyEventV2 } from 'aws-lambda';

export function makeEvent(
  method: string,
  path: string,
  overrides: Partial<APIGatewayProxyEventV2> = {},
): APIGatewayProxyEventV2 {
  return {
    version: '2.0',
    routeKey: 'ANY /api/{proxy+}',
    rawPath: path,
    rawQueryString: '',
    headers: {},
    isBase64Encoded: false,
    requestContext: {
      accountId: '123456789012',
      apiId: 'api',
      domainName: 'example.execute-api.us-east-1.amazonaws.com',
      domainPrefix: 'example',
      http: { method, path, protocol: 'HTTP/1.1', sourceIp: '203.0.113.1', userAgent: 'vitest' },
      requestId: 'req-123',
      routeKey: 'ANY /api/{proxy+}',
      stage: '$default',
      time: '01/Oct/2026:00:00:00 +0000',
      timeEpoch: 0,
    },
    ...overrides,
  };
}
