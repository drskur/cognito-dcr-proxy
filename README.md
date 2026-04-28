# @drskur/dcr-proxy

OAuth Dynamic Client Registration (DCR) proxy for Amazon Cognito, packaged as an AWS CDK construct.

Lets MCP clients (Claude Code, Kiro CLI, MCP Inspector, ...) authenticate against an Amazon Cognito User Pool while:

- keeping the **Cognito Hosted UI** flow intact (sign-up, password reset, MFA, social federation),
- supporting clients that demand **RFC 7591 Dynamic Client Registration**, and
- never exposing the Cognito App Client secret to the client.

> **Status:** early development. Not yet published to npm.

## How it works

```
[MCP Client] ── DCR / token ──▶ [DCR Proxy] ── adds client_secret ──▶ [Cognito]
     │                                                                    │
     │                                                                    │
     └────── browser auth (authorize) ──────────────────────────▶ [Cognito Hosted UI]
                                                                          │
     ◀──────────── code via redirect_uri ──────────────────────────────────┘

     ── MCP request + Bearer JWT ──▶ [AgentCore Gateway] ── verifies via Cognito JWKS
```

The proxy implements the four endpoints MCP clients need:

| Endpoint | Method | Purpose |
| --- | --- | --- |
| `/.well-known/oauth-protected-resource` | GET | RFC 9728 — points clients at the authorization server |
| `/.well-known/oauth-authorization-server` | GET | RFC 8414 — Cognito metadata with `token_endpoint` and `registration_endpoint` rewritten to the proxy |
| `/register` | POST | RFC 7591 — validates redirect URIs against an allow-list, returns the static Cognito `client_id` (no secret) |
| `/oauth/token` | POST | Forwards the token request to Cognito after injecting the server-side `client_secret` |

The `authorization_endpoint` and `jwks_uri` are **not** proxied — clients hit Cognito Hosted UI and JWKS directly.

## Install

```sh
pnpm add @drskur/dcr-proxy
```

Peer dependencies: `aws-cdk-lib ^2.150`, `constructs ^10`.

## Usage

```ts
import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { McpAuthProxy } from '@drskur/dcr-proxy';

export class MyStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const userPool = new cognito.UserPool(this, 'UserPool', {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
    });

    const client = userPool.addClient('Client', {
      generateSecret: true, // confidential client — required
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE, cognito.OAuthScope.EMAIL],
        callbackUrls: [
          'http://localhost:33418/callback',
          'http://localhost:6274/oauth/callback',
          'http://127.0.0.1:33418/',
        ],
      },
    });

    const domain = userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: `mcp-auth-${this.account}` },
    });

    const proxy = new McpAuthProxy(this, 'AuthProxy', {
      userPool,
      userPoolClient: client,
      cognitoDomain: domain,
      resourceUri: 'https://my-gateway.bedrock-agentcore.amazonaws.com/mcp',
      allowedRedirectPatterns: [
        /^http:\/\/localhost:\d+\/callback$/,
        /^http:\/\/localhost:\d+\/oauth\/callback$/,
        /^http:\/\/127\.0\.0\.1:\d+\/?$/,
      ],
    });

    new CfnOutput(this, 'ProxyUrl', { value: proxy.proxyUrl });
  }
}
```

A working example lives under [`examples/basic`](./examples/basic).

## API

### `new McpAuthProxy(scope, id, props)`

#### Props

| Name | Type | Required | Notes |
| --- | --- | --- | --- |
| `userPool` | `cognito.IUserPool` | yes | Existing User Pool. |
| `userPoolClient` | `cognito.IUserPoolClient` | yes | Confidential App Client (must have a secret). |
| `cognitoDomain` | `cognito.UserPoolDomain` | yes | Hosted UI domain attached to the User Pool. |
| `resourceUri` | `string` | yes | URL of the protected resource (e.g. AgentCore Gateway MCP endpoint). |
| `allowedRedirectPatterns` | `RegExp[]` | no | Patterns each registered `redirect_uri` must match. Empty = reject all. |
| `cors` | `CorsOptions \| false` | no | CORS preflight config. Defaults to `allowOrigins: ['*']`, headers `authorization, content-type, mcp-protocol-version`, maxAge 10min. Pass `false` to disable. |
| `throttling` | `ThrottlingOptions` | no | Stage-level throttling. Defaults to `rateLimit: 50`, `burstLimit: 100`. |
| `reservedConcurrentExecutions` | `number` | no | Reserved concurrency applied to every Lambda. |
| `lambdaEnvironment` | `Record<string, string>` | no | Extra env vars merged into all four Lambdas. |
| `logRetention` | `logs.RetentionDays` | no | Defaults to `ONE_WEEK`. |
| `removalPolicy` | `RemovalPolicy` | no | Applied to the Secrets Manager secret and Lambda log groups. Defaults to `DESTROY`. |

#### Outputs

| Property | Description |
| --- | --- |
| `httpApi` | The underlying `apigatewayv2.HttpApi` (for adding custom domains, etc.). |
| `proxyUrl` | Base URL of the HTTP API. |
| `metadataUrl` | Full URL of the protected-resource metadata. |
| `authServerMetadataUrl` | Full URL of the authorization-server metadata. |
| `tokenEndpoint` | Token endpoint URL. |
| `registrationEndpoint` | DCR endpoint URL. |

## AgentCore Gateway integration

This package does **not** create the Gateway. Configure it yourself with a `CUSTOM_JWT` authorizer pointed at Cognito directly — the Gateway should know nothing about the proxy:

```ts
authorizerConfiguration: {
  customJWTAuthorizer: {
    discoveryUrl: `https://cognito-idp.${region}.amazonaws.com/${userPool.userPoolId}/.well-known/openid-configuration`,
    allowedClients: [client.userPoolClientId],
  },
}
```

The proxy only smooths the OAuth dance for clients. JWT verification stays between the MCP client → Gateway → Cognito JWKS.

## Cognito setup checklist

- [ ] User Pool created.
- [ ] App Client with **client secret** enabled.
- [ ] App Client OAuth grant types: **Authorization code grant** + PKCE.
- [ ] App Client `callbackUrls` includes every redirect URI that `allowedRedirectPatterns` would accept (Cognito enforces an exact-match allow-list — patterns alone are not enough).
- [ ] Hosted UI domain configured.

## Known limitations

- **`issuer` mismatch.** The `/.well-known/oauth-authorization-server` response keeps Cognito's `issuer` claim so that JWT `iss` validation still succeeds. RFC 8414 says the `issuer` should equal the metadata document's base URL, so strict OAuth clients may reject the metadata. Most MCP clients do not enforce this.
- **Single backing Cognito client.** Every DCR caller receives the same `client_id`. There is no per-client isolation, throttling, or revocation.
- **`redirect_uri` allow-list is double-bounded.** Patterns are checked in `/register`, but Cognito independently enforces its own callback URL allow-list at `/authorize`. Both must permit the URI.
- **CORS defaults to `*`.** Convenient for MCP Inspector and similar tools, but production deployments should pass an explicit `cors.allowOrigins` list (or `cors: false` if not needed).
- **Cognito-only.** The construct hardcodes Cognito-specific behaviors (Hosted UI URL shape, secret handling). It is not a general-purpose OAuth proxy.

## License

MIT — see [LICENSE](./LICENSE).
