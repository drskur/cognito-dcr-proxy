process.env.COGNITO_CLIENT_ID = 'client-abc';
process.env.ALLOWED_REDIRECT_PATTERNS = JSON.stringify([
  '^http:\\/\\/localhost:\\d+\\/callback$',
  '^http:\\/\\/127\\.0\\.0\\.1:\\d+\\/?$',
]);

import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { handler } from '../../src/lambda/register';

const ctx = {} as Context;
const cb = () => {};

function invoke(body: string | undefined) {
  const event = { body, isBase64Encoded: false } as unknown as APIGatewayProxyEventV2;
  return handler(event, ctx, cb) as Promise<{ statusCode: number; body: string }>;
}

describe('register', () => {
  test('rejects missing body', async () => {
    const res = await invoke(undefined);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('invalid_client_metadata');
  });

  test('rejects invalid JSON', async () => {
    const res = await invoke('not json');
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('invalid_client_metadata');
  });

  test('rejects missing redirect_uris', async () => {
    const res = await invoke(JSON.stringify({}));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('invalid_redirect_uri');
  });

  test('rejects redirect_uri not matching any pattern', async () => {
    const res = await invoke(JSON.stringify({ redirect_uris: ['http://evil.com/cb'] }));
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('invalid_redirect_uri');
  });

  test('rejects non-string redirect_uri entries', async () => {
    const res = await invoke(JSON.stringify({ redirect_uris: [123] }));
    expect(res.statusCode).toBe(400);
  });

  test('accepts matching redirect_uris and returns Cognito client_id', async () => {
    const res = await invoke(
      JSON.stringify({
        redirect_uris: ['http://localhost:33418/callback', 'http://127.0.0.1:6274/'],
      }),
    );
    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.client_id).toBe('client-abc');
    expect(body.token_endpoint_auth_method).toBe('none');
    expect(body.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(body.response_types).toEqual(['code']);
    expect(body.redirect_uris).toEqual([
      'http://localhost:33418/callback',
      'http://127.0.0.1:6274/',
    ]);
  });
});
