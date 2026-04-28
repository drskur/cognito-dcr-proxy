process.env.COGNITO_ISSUER = 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_xxx';

import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';

const fetchMock = jest.fn();
(global as unknown as { fetch: typeof fetchMock }).fetch = fetchMock;

const ctx = {} as Context;
const cb = () => {};

const upstream = {
  issuer: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_xxx',
  authorization_endpoint: 'https://cognito-domain.auth.us-east-1.amazoncognito.com/oauth2/authorize',
  token_endpoint: 'https://cognito-domain.auth.us-east-1.amazoncognito.com/oauth2/token',
  jwks_uri: 'https://cognito-idp.us-east-1.amazonaws.com/us-east-1_xxx/.well-known/jwks.json',
  response_types_supported: ['code'],
  scopes_supported: ['openid', 'profile', 'email'],
};

function event(domain: string): APIGatewayProxyEventV2 {
  return { requestContext: { domainName: domain } } as unknown as APIGatewayProxyEventV2;
}

describe('authorization-server-metadata', () => {
  beforeEach(() => {
    jest.resetModules();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, json: async () => upstream });
  });

  test('overrides token_endpoint and registration_endpoint to proxy URL', async () => {
    const { handler } = await import('../../src/lambda/authorization-server-metadata');
    const res = (await handler(event('proxy.example.com'), ctx, cb)) as {
      statusCode: number;
      body: string;
    };
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.token_endpoint).toBe('https://proxy.example.com/oauth/token');
    expect(body.registration_endpoint).toBe('https://proxy.example.com/register');
  });

  test('preserves Cognito-issued fields (issuer, authorization_endpoint, jwks_uri)', async () => {
    const { handler } = await import('../../src/lambda/authorization-server-metadata');
    const res = (await handler(event('proxy.example.com'), ctx, cb)) as {
      statusCode: number;
      body: string;
    };
    const body = JSON.parse(res.body);
    expect(body.issuer).toBe(upstream.issuer);
    expect(body.authorization_endpoint).toBe(upstream.authorization_endpoint);
    expect(body.jwks_uri).toBe(upstream.jwks_uri);
  });

  test('caches upstream metadata across invocations', async () => {
    const { handler } = await import('../../src/lambda/authorization-server-metadata');
    await handler(event('proxy.example.com'), ctx, cb);
    await handler(event('proxy.example.com'), ctx, cb);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('throws when upstream discovery fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error' });
    const { handler } = await import('../../src/lambda/authorization-server-metadata');
    await expect(handler(event('proxy.example.com'), ctx, cb)).rejects.toThrow(/Cognito discovery failed/);
  });
});
