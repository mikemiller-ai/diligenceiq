import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import type { Construct } from 'constructs';
import { CONFIG, PRODUCTION_URL } from './config';

export interface WebStackProps extends StackProps {
  /** `https://{apiId}.execute-api.{region}.amazonaws.com`, no trailing slash. */
  apiEndpoint: string;
}

export const SECURITY_HEADERS: ReadonlyArray<readonly [string, string]> = [
  ['Strict-Transport-Security', 'max-age=31536000; includeSubDomains'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['X-Frame-Options', 'DENY'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=()'],
  // Script-neutral on purpose: the static export's inline scripts need a hash or nonce
  // strategy, which is decided in Phase 7 (assumptions D10).
  ['Content-Security-Policy', "frame-ancestors 'none'; base-uri 'self'; object-src 'none'"],
];

function customHeadersYaml(): string {
  const lines = ['customHeaders:', "  - pattern: '**'", '    headers:'];
  for (const [key, value] of SECURITY_HEADERS) {
    lines.push(`      - key: '${key}'`, `        value: "${value}"`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Amplify Hosting with no connected repository: builds are uploaded as zips with
 * `aws amplify create-deployment` / `start-deployment` (same as TrustResponse).
 */
export class WebStack extends Stack {
  public readonly app: amplify.CfnApp;
  public readonly branch: amplify.CfnBranch;
  public readonly domain: amplify.CfnDomain;

  constructor(scope: Construct, id: string, props: WebStackProps) {
    super(scope, id, props);

    this.app = new amplify.CfnApp(this, 'App', {
      name: CONFIG.web.appName,
      platform: 'WEB',
      // Order matters: Amplify applies the first matching rule.
      customRules: [
        { source: '/api/<*>', target: `${props.apiEndpoint}/api/<*>`, status: '200' },
        // '404' (not '404-200') so unknown paths return a real 404 status; Amplify applies it only when no file matches.
        { source: '/<*>', target: '/404.html', status: '404' },
      ],
      customHeaders: customHeadersYaml(),
    });

    this.branch = new amplify.CfnBranch(this, 'MainBranch', {
      appId: this.app.attrAppId,
      branchName: CONFIG.web.branchName,
      stage: 'PRODUCTION',
      framework: 'Web',
      enableAutoBuild: false,
    });

    // Amplify writes the DNS records into the existing mikemiller.ai Route 53 zone, as it
    // does for resolveiq, trustresponse and careerops.
    this.domain = new amplify.CfnDomain(this, 'Domain', {
      appId: this.app.attrAppId,
      domainName: CONFIG.web.domainName,
      enableAutoSubDomain: false,
      subDomainSettings: [{ prefix: CONFIG.web.subdomainPrefix, branchName: this.branch.attrBranchName }],
    });

    new CfnOutput(this, 'AmplifyAppId', { value: this.app.attrAppId });
    new CfnOutput(this, 'BranchName', { value: this.branch.attrBranchName });
    new CfnOutput(this, 'ProductionUrl', { value: PRODUCTION_URL });
    new CfnOutput(this, 'AmplifyDefaultDomain', { value: this.app.attrDefaultDomain });
  }
}
