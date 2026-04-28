import { App, Stack } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { McpAuthProxy } from '../../src';

function makeStack() {
  const app = new App();
  const stack = new Stack(app, 'TestStack', { env: { account: '123456789012', region: 'us-east-1' } });
  const userPool = new cognito.UserPool(stack, 'UserPool');
  const client = userPool.addClient('Client', { generateSecret: true });
  const domain = userPool.addDomain('Domain', {
    cognitoDomain: { domainPrefix: 'test-prefix' },
  });
  return { stack, userPool, client, domain };
}

describe('McpAuthProxy', () => {
  test('creates one http api, one secret, four routes', () => {
    const { stack, userPool, client, domain } = makeStack();
    new McpAuthProxy(stack, 'Proxy', {
      userPool,
      userPoolClient: client,
      cognitoDomain: domain,
      resourceUri: 'https://example.com/mcp',
      allowedRedirectPatterns: [/^http:\/\/localhost:\d+\/callback$/],
    });

    const t = Template.fromStack(stack);
    t.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
    t.resourceCountIs('AWS::ApiGatewayV2::Route', 4);
    t.resourceCountIs('AWS::SecretsManager::Secret', 1);

    // Filter by ARM64 + nodejs20.x to exclude Cognito custom-resource lambdas.
    const proxyLambdas = t.findResources('AWS::Lambda::Function', {
      Properties: { Runtime: 'nodejs20.x', Architectures: ['arm64'] },
    });
    expect(Object.keys(proxyLambdas)).toHaveLength(4);
  });

  test('all four oauth routes are present', () => {
    const { stack, userPool, client, domain } = makeStack();
    new McpAuthProxy(stack, 'Proxy', {
      userPool,
      userPoolClient: client,
      cognitoDomain: domain,
      resourceUri: 'https://example.com/mcp',
    });
    const t = Template.fromStack(stack);

    for (const route of [
      'GET /.well-known/oauth-protected-resource',
      'GET /.well-known/oauth-authorization-server',
      'POST /register',
      'POST /oauth/token',
    ]) {
      t.hasResourceProperties('AWS::ApiGatewayV2::Route', { RouteKey: route });
    }
  });

  test('throttling defaults applied to default stage', () => {
    const { stack, userPool, client, domain } = makeStack();
    new McpAuthProxy(stack, 'Proxy', {
      userPool,
      userPoolClient: client,
      cognitoDomain: domain,
      resourceUri: 'https://example.com/mcp',
    });
    Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: {
        ThrottlingRateLimit: 50,
        ThrottlingBurstLimit: 100,
      },
    });
  });

  test('cors=false omits CorsConfiguration', () => {
    const { stack, userPool, client, domain } = makeStack();
    new McpAuthProxy(stack, 'Proxy', {
      userPool,
      userPoolClient: client,
      cognitoDomain: domain,
      resourceUri: 'https://example.com/mcp',
      cors: false,
    });
    Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.absent(),
    });
  });

  test('default cors uses wildcard origins', () => {
    const { stack, userPool, client, domain } = makeStack();
    new McpAuthProxy(stack, 'Proxy', {
      userPool,
      userPoolClient: client,
      cognitoDomain: domain,
      resourceUri: 'https://example.com/mcp',
    });
    Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({
        AllowOrigins: ['*'],
      }),
    });
  });

  test('throttling overrides apply', () => {
    const { stack, userPool, client, domain } = makeStack();
    new McpAuthProxy(stack, 'Proxy', {
      userPool,
      userPoolClient: client,
      cognitoDomain: domain,
      resourceUri: 'https://example.com/mcp',
      throttling: { rateLimit: 5, burstLimit: 10 },
    });
    Template.fromStack(stack).hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: {
        ThrottlingRateLimit: 5,
        ThrottlingBurstLimit: 10,
      },
    });
  });
});
