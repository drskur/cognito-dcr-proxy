process.env.COGNITO_HOSTED_UI_BASE = 'https://cognito-domain.auth.us-east-1.amazoncognito.com';
process.env.COGNITO_CLIENT_ID = 'real-client-id';
process.env.COGNITO_CLIENT_SECRET_ARN = 'arn:aws:secretsmanager:us-east-1:123:secret:foo';
process.env.COGNITO_REGION = 'us-east-1';

import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';

// Set up the SDK mock BEFORE the handler module is loaded so its module-scope
// `new SecretsManagerClient(...)` returns an intercepted instance.
const smMock = mockClient(SecretsManagerClient);

const fetchMock = jest.fn();
(global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;

let handler: typeof import('../../src/lambda/token').handler;

beforeAll(async () => {
  handler = (await import('../../src/lambda/token')).handler;
});

const ctx = {} as Context;
const cb = () => {};

function event(body: string | undefined, isBase64Encoded = false): APIGatewayProxyEventV2 {
  return { body, isBase64Encoded } as unknown as APIGatewayProxyEventV2;
}

describe('token', () => {
  beforeEach(() => {
    smMock.reset();
    fetchMock.mockReset();
    smMock.on(GetSecretValueCommand).resolves({ SecretString: 'top-secret' });
    fetchMock.mockResolvedValue({
      status: 200,
      headers: { get: (k: string) => (k === 'content-type' ? 'application/json' : null) },
      text: async () => '{"access_token":"jwt-token","token_type":"Bearer"}',
    });
  });

  test('rejects missing body', async () => {
    const res = (await handler(event(undefined), ctx, cb)) as { statusCode: number; body: string };
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('invalid_request');
  });

  test('forwards form-encoded body to Cognito with secret injected', async () => {
    const body =
      'grant_type=authorization_code&code=auth-code-123&' +
      'redirect_uri=http%3A%2F%2Flocalhost%3A33418%2Fcallback&' +
      'code_verifier=verifier&client_id=ignored';
    await handler(event(body), ctx, cb);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://cognito-domain.auth.us-east-1.amazoncognito.com/oauth2/token');
    expect(init.method).toBe('POST');

    const sent = new URLSearchParams(init.body as string);
    expect(sent.get('client_id')).toBe('real-client-id');
    expect(sent.get('client_secret')).toBe('top-secret');
    expect(sent.get('code')).toBe('auth-code-123');
    expect(sent.get('grant_type')).toBe('authorization_code');
    expect(sent.get('code_verifier')).toBe('verifier');
  });

  test('decodes base64-encoded body', async () => {
    const body = Buffer.from('grant_type=refresh_token&refresh_token=rt').toString('base64');
    await handler(event(body, true), ctx, cb);

    const [, init] = fetchMock.mock.calls[0];
    const sent = new URLSearchParams(init.body as string);
    expect(sent.get('grant_type')).toBe('refresh_token');
    expect(sent.get('refresh_token')).toBe('rt');
  });

  test('returns Cognito response status and body verbatim', async () => {
    fetchMock.mockResolvedValue({
      status: 400,
      headers: { get: (k: string) => (k === 'content-type' ? 'application/json' : null) },
      text: async () => '{"error":"invalid_grant"}',
    });
    const res = (await handler(event('grant_type=authorization_code'), ctx, cb)) as {
      statusCode: number;
      body: string;
      headers: Record<string, string>;
    };
    expect(res.statusCode).toBe(400);
    expect(res.body).toBe('{"error":"invalid_grant"}');
    expect(res.headers['content-type']).toBe('application/json');
  });
});
