import * as oidc from 'oidc-provider';

const host = '127.0.0.1';
const port = Number(process.env.TEST_OIDC_PORT ?? '3199');
const issuer = process.env.TEST_OIDC_ISSUER ?? `http://localhost:${port}`;
const webUrl = process.env.TEST_WEB_URL ?? 'http://localhost:3000';
const audience = process.env.TEST_AUTH_AUDIENCE ?? 'http://localhost:3001';
const clientId = process.env.TEST_AUTH_CLIENT_ID ?? 'atlas-web';

const provider = new oidc.Provider(issuer, {
  clients: [
    {
      client_id: clientId,
      client_name: 'Atlas Browser E2E',
      application_type: 'web',
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      redirect_uris: [`${webUrl}/auth/callback`],
      post_logout_redirect_uris: [webUrl],
    },
  ],
  claims: {
    openid: ['sub'],
    profile: ['name'],
  },
  cookies: {
    keys: ['atlas-browser-e2e-cookie-key-not-for-production'],
  },
  features: {
    devInteractions: { enabled: true },
    resourceIndicators: {
      enabled: true,
      defaultResource: async (_ctx, _client, requested) => requested ?? audience,
      getResourceServerInfo: async (_ctx, resourceIndicator) => {
        if (resourceIndicator !== audience) throw new oidc.errors.InvalidTarget();
        return {
          scope: 'atlas:access',
          audience,
          accessTokenFormat: 'jwt',
          accessTokenTTL: 300,
        };
      },
    },
  },
  findAccount: async (_ctx, accountId) => ({
    accountId,
    claims: async () => ({ sub: accountId, name: 'Atlas Browser User' }),
  }),
  extraTokenClaims: async (ctx, token) => ({
    groups: [
      'atlas-user',
      token.accountId === 'atlas-viewer-user' || ctx.oidc.session?.accountId === 'atlas-viewer-user'
        ? 'atlas-viewer'
        : token.accountId === 'atlas-analyst-user' ||
            ctx.oidc.session?.accountId === 'atlas-analyst-user'
          ? 'atlas-analyst'
          : 'atlas-admin',
    ],
    name: 'Atlas Browser User',
  }),
  pkce: {
    methods: ['S256'],
    required: () => true,
  },
});

provider.proxy = false;

const server = provider.listen(port, host, () => {
  process.stdout.write(`Atlas test OIDC issuer listening at ${issuer}\n`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
