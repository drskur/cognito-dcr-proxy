import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

const COGNITO_HOSTED_UI_BASE = process.env.COGNITO_HOSTED_UI_BASE!;

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  const params = new URLSearchParams(event.rawQueryString ?? '');

  console.log('[authorize] incoming params', {
    keys: Array.from(params.keys()).sort(),
    scope: params.get('scope'),
    redirect_uri: params.get('redirect_uri'),
    response_type: params.get('response_type'),
    client_id: params.get('client_id'),
    resource: params.get('resource'),
    code_challenge_method: params.get('code_challenge_method'),
  });

  // RFC 8707 `resource` parameter binds the access token's `aud` claim to
  // the given URL. Cognito accepts it at /authorize but rejects the token
  // exchange with `invalid_grant` when the URL is not registered as a
  // resource server. MCP clients send this unconditionally, so strip it.
  params.delete('resource');

  const target = `${COGNITO_HOSTED_UI_BASE}/oauth2/authorize?${params.toString()}`;
  return {
    statusCode: 302,
    headers: { location: target },
    body: '',
  };
};
