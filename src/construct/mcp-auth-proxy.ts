import * as path from 'path';
import { Construct } from 'constructs';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

export interface McpAuthProxyProps {
  readonly userPool: cognito.IUserPool;
  readonly userPoolClient: cognito.IUserPoolClient;
  readonly cognitoDomain: cognito.UserPoolDomain;

  readonly resourceUri: string;

  readonly allowedRedirectPatterns?: RegExp[];

  readonly lambdaEnvironment?: Record<string, string>;
  readonly logRetention?: logs.RetentionDays;
  readonly removalPolicy?: RemovalPolicy;
}

const LAMBDA_DIR = path.join(__dirname, '..', '..', 'src', 'lambda');

const entry = (file: string): string => path.join(LAMBDA_DIR, file);

export class McpAuthProxy extends Construct {
  readonly httpApi: apigwv2.HttpApi;
  readonly proxyUrl: string;
  readonly metadataUrl: string;
  readonly authServerMetadataUrl: string;
  readonly tokenEndpoint: string;
  readonly registrationEndpoint: string;

  constructor(scope: Construct, id: string, props: McpAuthProxyProps) {
    super(scope, id);

    const region = Stack.of(this).region;

    const clientSecret = new secretsmanager.Secret(this, 'CognitoClientSecret', {
      secretStringValue: props.userPoolClient.userPoolClientSecret,
      removalPolicy: props.removalPolicy ?? RemovalPolicy.DESTROY,
    });

    const cognitoIssuer = `https://cognito-idp.${region}.amazonaws.com/${props.userPool.userPoolId}`;
    const hostedUiBase = props.cognitoDomain.baseUrl();

    const baseEnv: Record<string, string> = {
      COGNITO_USER_POOL_ID: props.userPool.userPoolId,
      COGNITO_CLIENT_ID: props.userPoolClient.userPoolClientId,
      COGNITO_CLIENT_SECRET_ARN: clientSecret.secretArn,
      COGNITO_ISSUER: cognitoIssuer,
      COGNITO_HOSTED_UI_BASE: hostedUiBase,
      COGNITO_REGION: region,
      RESOURCE_URI: props.resourceUri,
      ALLOWED_REDIRECT_PATTERNS: JSON.stringify(
        (props.allowedRedirectPatterns ?? []).map((r) => r.source),
      ),
      ...(props.lambdaEnvironment ?? {}),
    };

    const logRetention = props.logRetention ?? logs.RetentionDays.ONE_WEEK;

    const makeFn = (id_: string, file: string): nodejs.NodejsFunction =>
      new nodejs.NodejsFunction(this, id_, {
        entry: entry(file),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_20_X,
        architecture: lambda.Architecture.ARM_64,
        timeout: Duration.seconds(10),
        memorySize: 256,
        environment: baseEnv,
        logRetention,
        bundling: {
          target: 'node20',
          format: nodejs.OutputFormat.CJS,
          minify: true,
          sourceMap: true,
          externalModules: ['@aws-sdk/*'],
        },
      });

    const protectedResourceFn = makeFn('ProtectedResourceFn', 'protected-resource-metadata.ts');
    const authServerFn = makeFn('AuthServerFn', 'authorization-server-metadata.ts');
    const registerFn = makeFn('RegisterFn', 'register.ts');
    const tokenFn = makeFn('TokenFn', 'token.ts');

    clientSecret.grantRead(tokenFn);

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: `${id}-mcp-auth-proxy`,
      description: 'MCP-compatible OAuth proxy for Amazon Cognito',
    });

    this.httpApi.addRoutes({
      path: '/.well-known/oauth-protected-resource',
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('ProtectedResourceInt', protectedResourceFn),
    });

    this.httpApi.addRoutes({
      path: '/.well-known/oauth-authorization-server',
      methods: [apigwv2.HttpMethod.GET],
      integration: new integrations.HttpLambdaIntegration('AuthServerInt', authServerFn),
    });

    this.httpApi.addRoutes({
      path: '/register',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('RegisterInt', registerFn),
    });

    this.httpApi.addRoutes({
      path: '/oauth/token',
      methods: [apigwv2.HttpMethod.POST],
      integration: new integrations.HttpLambdaIntegration('TokenInt', tokenFn),
    });

    this.proxyUrl = this.httpApi.apiEndpoint;
    this.metadataUrl = `${this.proxyUrl}/.well-known/oauth-protected-resource`;
    this.authServerMetadataUrl = `${this.proxyUrl}/.well-known/oauth-authorization-server`;
    this.tokenEndpoint = `${this.proxyUrl}/oauth/token`;
    this.registrationEndpoint = `${this.proxyUrl}/register`;
  }
}
