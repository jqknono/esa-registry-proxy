const VERSION = '1.2.0';

// Hardcoded to Docker Hub official registry only — no mirrors, no overrides.
const UPSTREAM = Object.freeze({
  registryHost: 'registry-1.docker.io',
  authUrl: 'https://auth.docker.io/token',
  authService: 'registry.docker.io',
  displayName: 'Docker Hub Official Registry'
});

const CONFIG = {
  whitelist: ['library/nginx', 'jqknono/weread-challenge', 'nullprivate/nullprivate'],
  enableManifestCache: true,
  manifestCacheTtl: 60,
  enableDebugEndpoint: true
};

const DEFAULT_WHITELIST = ['library/nginx', 'jqknono/weread-challenge', 'nullprivate/nullprivate'];
const DEFAULT_MANIFEST_CACHE_TTL = 60;
const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
  'application/vnd.docker.distribution.manifest.v1+prettyjws'
].join(', ');

function parseCsv(value, fallback = []) {
  if (!value || typeof value !== 'string') {
    return [...fallback];
  }

  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseNumber(value, defaultValue) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : defaultValue;
}

function normalizeDigest(digest) {
  if (!digest || typeof digest !== 'string') {
    return null;
  }

  const trimmed = digest.trim();
  return /^[a-z0-9_+.-]+:[A-Fa-f0-9]+$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

function getUpstream() {
  return UPSTREAM;
}

function buildUpstreamUrl(upstream, pathname, search = '') {
  return `https://${upstream.registryHost}${pathname}${search}`;
}

function buildAuthRedirectUrl(requestUrl, upstream) {
  const requestUrlObject = new URL(requestUrl);
  const authUrlObject = new URL(upstream.authUrl);

  requestUrlObject.searchParams.forEach((value, key) => {
    authUrlObject.searchParams.set(key, value);
  });

  if (upstream.authService) {
    authUrlObject.searchParams.set('service', upstream.authService);
  }

  return authUrlObject.toString();
}

function buildRuntimeConfig() {
  const whitelist = parseCsv(CONFIG.whitelist, DEFAULT_WHITELIST);

  return {
    upstream: getUpstream(),
    whitelist,
    manifestCacheTtl: parseNumber(CONFIG.manifestCacheTtl, DEFAULT_MANIFEST_CACHE_TTL),
    enableManifestCache: parseBoolean(CONFIG.enableManifestCache, true),
    debugEnabled: parseBoolean(CONFIG.enableDebugEndpoint, true)
  };
}

function isWhitelisted(image, whitelist) {
  if (whitelist.includes(image)) {
    return true;
  }

  for (const pattern of whitelist) {
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      if (image.startsWith(`${prefix}/`)) {
        return true;
      }
    }
  }

  return false;
}

function parseImageName(pathname) {
  let imageName = pathname.replace(/^\/v2\//, '');
  imageName = imageName.replace(/\/(manifests|blobs)\/.*/, '');
  imageName = imageName.replace(/\/tags\/list.*/, '');
  imageName = imageName.replace(/\/_catalog.*/, '');
  imageName = imageName.replace(/\/$/, '');
  return imageName.split(':')[0].split('@')[0];
}

function extractReference(pathname, segment) {
  const match = pathname.match(new RegExp(`^/v2/(.+?)/${segment}/(.+)$`));
  return match ? match[2] : null;
}

function isManifestRequest(pathname) {
  return pathname.includes('/manifests/');
}

function isBlobRequest(pathname) {
  return pathname.includes('/blobs/');
}

function pickRequestHeaders(request, allowedHeaders) {
  const headers = new Headers();
  for (const name of allowedHeaders) {
    const value = request.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }
  return headers;
}

function mergeCacheControl(currentValue, maxAgeSeconds) {
  if (!currentValue) {
    return `public, max-age=${maxAgeSeconds}`;
  }

  if (/max-age=\d+/i.test(currentValue)) {
    return currentValue;
  }

  return `${currentValue}, max-age=${maxAgeSeconds}`;
}

function buildManifestCacheKey(targetUrl, acceptHeader) {
  return `${targetUrl}::accept=${acceptHeader || ''}`;
}

function getManifestCache() {
  try {
    if (typeof cache !== 'undefined' && cache && typeof cache.get === 'function' && typeof cache.put === 'function') {
      return cache;
    }
  } catch (error) {
    console.warn('Manifest cache unavailable:', error?.message || error);
  }

  return null;
}

async function fetchManifestResponseFromUpstream(request, targetUrl, config) {
  const acceptHeader = request.headers.get('accept') || MANIFEST_ACCEPT;
  const shouldUseCache = config.enableManifestCache && request.method === 'GET' && !request.headers.has('authorization');
  const cacheApi = shouldUseCache ? getManifestCache() : null;
  const cacheKey = buildManifestCacheKey(targetUrl, acceptHeader);

  if (cacheApi) {
    try {
      const cachedResponse = await cacheApi.get(cacheKey);
      if (cachedResponse) {
        const headers = new Headers(cachedResponse.headers);
        headers.set('x-esa-registry-manifest-source', 'upstream-cache');
        return new Response(cachedResponse.body, {
          status: cachedResponse.status,
          statusText: cachedResponse.statusText,
          headers
        });
      }
    } catch (error) {
      console.warn('Manifest cache read failed:', error?.message || error);
    }
  }

  const headers = pickRequestHeaders(request, ['accept', 'authorization', 'if-none-match', 'if-modified-since', 'user-agent']);
  headers.set('accept', acceptHeader);

  const upstreamResponse = await fetch(targetUrl, {
    method: request.method,
    headers,
    redirect: 'follow'
  });

  const responseHeaders = new Headers(upstreamResponse.headers);
  responseHeaders.set('cache-control', mergeCacheControl(responseHeaders.get('cache-control'), config.manifestCacheTtl));
  responseHeaders.set('x-esa-registry-manifest-source', 'upstream');
  const response = new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: responseHeaders
  });

  if (cacheApi && upstreamResponse.ok) {
    try {
      await cacheApi.put(cacheKey, response.clone());
    } catch (error) {
      console.warn('Manifest cache write failed:', error?.message || error);
    }
  }

  return response;
}

function buildBlobRedirectResponse(location, source, digest = null, blobEntry = null) {
  const headers = new Headers({
    location,
    'cache-control': 'no-store',
    'x-esa-registry-blob-source': source
  });

  if (digest) {
    headers.set('docker-content-digest', digest);
  }
  if (blobEntry?.size) {
    headers.set('content-length', String(blobEntry.size));
  }
  if (blobEntry?.mediaType) {
    headers.set('content-type', blobEntry.mediaType);
  }

  return new Response(null, {
    status: 307,
    headers
  });
}

async function fetchBlobRedirect(request, targetUrl) {
  const headers = pickRequestHeaders(request, ['accept', 'authorization', 'range', 'user-agent']);

  const upstreamResponse = await fetch(targetUrl, {
    method: request.method,
    headers,
    redirect: 'manual'
  });

  const location = upstreamResponse.headers.get('location');
  return { upstreamResponse, location };
}

async function handleBlobRequest(request, pathname, config) {
  const digest = normalizeDigest(extractReference(pathname, 'blobs'));
  if (!digest) {
    return new Response('Invalid blob path', { status: 400 });
  }

  const targetUrl = buildUpstreamUrl(config.upstream, pathname);
  const { upstreamResponse, location } = await fetchBlobRedirect(request, targetUrl);
  if (location) {
    return buildBlobRedirectResponse(location, 'upstream', digest);
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: new Headers(upstreamResponse.headers)
  });
}

async function handleManifestRequest(request, pathname, config) {
  const reference = extractReference(pathname, 'manifests');
  if (!reference) {
    return new Response('Invalid manifest path', { status: 400 });
  }

  const targetUrl = buildUpstreamUrl(config.upstream, pathname);
  return fetchManifestResponseFromUpstream(request, targetUrl, config);
}

async function handleAuth(request, config) {
  return Response.redirect(buildAuthRedirectUrl(request.url, config.upstream), 307);
}

async function handleRegistry(request, config) {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const imageName = parseImageName(pathname);

  if (imageName && !isWhitelisted(imageName, config.whitelist)) {
    return new Response(`Image ${imageName} is not in whitelist`, { status: 403 });
  }

  if (isBlobRequest(pathname)) {
    return handleBlobRequest(request, pathname, config);
  }

  if (isManifestRequest(pathname)) {
    return handleManifestRequest(request, pathname, config);
  }

  const targetUrl = buildUpstreamUrl(config.upstream, pathname, url.search);
  const headers = pickRequestHeaders(request, ['accept', 'authorization', 'if-none-match', 'if-modified-since', 'range', 'user-agent']);

  const upstreamResponse = await fetch(targetUrl, {
    method: request.method,
    headers,
    redirect: 'follow'
  });

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: new Headers(upstreamResponse.headers)
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const config = buildRuntimeConfig();

    try {
      if (pathname === '/version') {
        return new Response(JSON.stringify({
          version: VERSION,
          features: {
            blobRedirect: true,
            manifestCache: config.enableManifestCache,
            directOnly: true,
            upstreamLocked: true
          },
          upstream: {
            registryHost: config.upstream.registryHost,
            displayName: config.upstream.displayName
          }
        }, null, 2), {
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          status: 200
        });
      }

      if (pathname === '/v2/token') {
        return handleAuth(request, config);
      }

      if (pathname.startsWith('/v2/')) {
        return handleRegistry(request, config);
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      console.error('Handler error:', error.message);
      console.error('Handler error stack:', error.stack);
      return new Response(`Internal Server Error: ${error.message}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  }
};
