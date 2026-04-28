import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

const RESOURCE_URI = process.env.RESOURCE_URI!;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const proxyUrl = `https://${event.requestContext.domainName}`;
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      resource: RESOURCE_URI,
      authorization_servers: [proxyUrl],
    }),
  };
};
