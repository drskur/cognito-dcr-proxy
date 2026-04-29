import { Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { McpAuthProxy } from '@drskur/dcr-proxy';

export class ExampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'mcp-auth-proxy-example',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
    });

    const client = userPool.addClient('Client', {
      generateSecret: true,
      authFlows: { userPassword: true, userSrp: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PHONE,
        ],
        callbackUrls: [
          'http://localhost:33418/callback',
          'http://localhost:6274/oauth/callback',
          'http://127.0.0.1:33418/',
        ],
      },
    });

    const domain = userPool.addDomain('Domain', {
      cognitoDomain: {
        domainPrefix: `mcp-auth-proxy-${this.account}`,
      },
    });

    const proxy = new McpAuthProxy(this, 'AuthProxy', {
      userPool,
      userPoolClient: client,
      cognitoDomain: domain,
      resourceUri: 'https://example-gateway.bedrock-agentcore.amazonaws.com/mcp',
      allowedRedirectPatterns: [
        /^http:\/\/localhost:\d+\/callback$/,
        /^http:\/\/localhost:\d+\/oauth\/callback$/,
        /^http:\/\/127\.0\.0\.1:\d+\/?$/,
      ],
    });

    new CfnOutput(this, 'ProxyUrl', { value: proxy.proxyUrl });
    new CfnOutput(this, 'MetadataUrl', { value: proxy.metadataUrl });
    new CfnOutput(this, 'AuthServerMetadataUrl', { value: proxy.authServerMetadataUrl });
    new CfnOutput(this, 'TokenEndpoint', { value: proxy.tokenEndpoint });
    new CfnOutput(this, 'RegistrationEndpoint', { value: proxy.registrationEndpoint });
    new CfnOutput(this, 'CognitoUserPoolId', { value: userPool.userPoolId });
    new CfnOutput(this, 'CognitoClientId', { value: client.userPoolClientId });
  }
}
