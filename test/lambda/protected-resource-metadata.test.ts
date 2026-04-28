process.env.RESOURCE_URI = 'https://gateway.example.com/mcp';

import type { APIGatewayProxyEventV2, Context } from 'aws-lambda';
import { handler } from '../../src/lambda/protected-resource-metadata';

const ctx = {} as Context;
const cb = () => {};

function event(domain: string): APIGatewayProxyEventV2 {
  return { requestContext: { domainName: domain } } as unknown as APIGatewayProxyEventV2;
}

describe('protected-resource-metadata', () => {
  test('returns RFC 9728 document with proxy as authorization server', async () => {
    const res = (await handler(event('proxy.example.com'), ctx, cb)) as {
      statusCode: number;
      body: string;
    };
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual({
      resource: 'https://gateway.example.com/mcp',
      authorization_servers: ['https://proxy.example.com'],
    });
  });
});
