import { createClientFromRequest } from 'npm:@base44/sdk@0.8.25';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const configs = await base44.asServiceRole.entities.AppConfig.list();
    const config = configs[0];

    if (!config) {
      return Response.json({ error: 'No config found' }, { status: 404 });
    }

    const { bitrix24_app_client_id, bitrix24_app_client_secret, bitrix24_refresh_token, bitrix24_domain } = config;

    if (!bitrix24_app_client_id || !bitrix24_app_client_secret || !bitrix24_refresh_token) {
      return Response.json({ error: 'Missing client credentials or refresh token' }, { status: 400 });
    }

    // Refresh the access token
    const res = await fetch('https://oauth.bitrix.info/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: bitrix24_app_client_id,
        client_secret: bitrix24_app_client_secret,
        refresh_token: bitrix24_refresh_token,
      }),
    });

    const data = await res.json();

    if (!data.access_token) {
      return Response.json({ error: data.error_description || data.error || 'Refresh failed', raw: data }, { status: 400 });
    }

    // Save the new tokens
    await base44.asServiceRole.entities.AppConfig.update(config.id, {
      bitrix24_access_token: data.access_token,
      bitrix24_refresh_token: data.refresh_token || bitrix24_refresh_token,
      bitrix24_token_expires_at: new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString(),
    });

    // Test the new token with app.info
    const endpoint = bitrix24_domain.endsWith('/') ? bitrix24_domain : bitrix24_domain + '/';
    const testRes = await fetch(`${endpoint}app.info?auth=${encodeURIComponent(data.access_token)}`);
    const testData = await testRes.json();

    return Response.json({
      success: true,
      access_token: data.access_token,
      app_info: testData.result || null,
      error: testData.error_description || testData.error || null,
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});