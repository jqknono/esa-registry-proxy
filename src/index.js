// ESA边缘函数入口文件

const VERSION = '0.6.0';

// 默认白名单
const DEFAULT_WHITELIST = ['library/nginx', 'jqknono/weread-challenge', 'nullprivate/nullprivate'];

// 是否启用缓存功能，默认不启用
const ENABLE_CACHE = false;

// 最大缓存时间（30天）
const MAX_CACHE_AGE = 86400 * 30;

// 获取环境变量的函数，兼容不同环境
function getEnvVar(name, defaultValue = null) {
  // 在Node.js环境中使用process.env
  if (typeof process !== 'undefined' && process.env) {
    return process.env[name] || defaultValue;
  }

  // 在浏览器或Worker环境中尝试其他方式
  // 注意：在浏览器中出于安全原因通常无法访问环境变量
  // 这里可以添加特定平台的实现
  return defaultValue;
}

// 从环境变量获取白名单，如果没有则使用默认值
const WHITELIST = getEnvVar('WHITELIST') ?
  getEnvVar('WHITELIST').split(',').map(item => item.trim()) :
  DEFAULT_WHITELIST;

// 检查镜像是否在白名单中
function isWhitelisted(image) {
  // 精确匹配
  if (WHITELIST.includes(image)) {
    return true;
  }

  // 前缀匹配 (如 library/*)
  for (const pattern of WHITELIST) {
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      if (image.startsWith(prefix + '/')) {
        return true;
      }
    }
  }

  return false;
}

// 解析镜像名称
function parseImageName(path) {
  // 移除 /v2/ 前缀
  let imageName = path.replace(/^\/v2\//, '');

  // 移除 /manifests/ 或 /blobs/ 以及之后的部分
  // 保留完整的路径用于后续处理
  imageName = imageName.replace(/\/(manifests|blobs)\/.*/, '');

  // 移除标签或摘要部分（如果有）
  imageName = imageName.split(':')[0].split('@')[0];

  return imageName;
}

// 处理认证请求
async function handleAuth(request) {
  try {
    const url = new URL(request.url);
    const authUrl = `https://auth.docker.io/token${url.search}`;

    const response = await fetch(authUrl);
    const data = await response.json();

    return new Response(JSON.stringify(data), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (error) {
    console.error('Auth error:', error.message);
    console.error('Auth error stack:', error.stack);
    return new Response(`Authentication failed: ${error.message}`, { 
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// 获取 Docker Hub 访问令牌
async function getDockerHubToken(scope) {
  try {
    const authUrl = `https://auth.docker.io/token?service=registry.docker.io&scope=${scope}`;
    const response = await fetch(authUrl);
    const data = await response.json();
    return data.token;
  } catch (error) {
    console.error('Token error:', error.message);
    console.error('Token error stack:', error.stack);
    throw new Error(`Failed to get Docker Hub token: ${error.message}`);
  }
}

// 处理 Registry 请求（带缓存功能）
async function handleRegistry(request) {
  try {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // 解析镜像名称
    const imageName = parseImageName(pathname);

    // 添加调试日志
    console.log('Parsed image name:', imageName);
    console.log('Current whitelist:', WHITELIST);

    // 检查白名单
    if (!isWhitelisted(imageName)) {
      console.log(`Image ${imageName} is not in whitelist`);
      return new Response(`Image ${imageName} is not in whitelist`, { status: 403 });
    }

    // 构建目标 URL
    const targetUrl = `https://registry-1.docker.io${pathname}`;

    // 如果启用了缓存功能，首先尝试从缓存中获取响应
    if (ENABLE_CACHE) {
      const cachedResponse = await cache.get(targetUrl);
      if (cachedResponse) {
        console.log(`Cache hit for ${targetUrl}`);
        // 创建一个新的响应对象，避免"Body is unusable"错误
        const clonedResponse = new Response(cachedResponse.body, {
          status: cachedResponse.status,
          statusText: cachedResponse.statusText,
          headers: new Headers(cachedResponse.headers)
        });
        return clonedResponse;
      }
    }

    // 创建转发请求的选项
    const init = {
      method: request.method,
      headers: new Headers(request.headers), // 克隆原始请求头
      body: request.body,
      redirect: 'manual' // 必须手动处理重定向
    };

    // 替换 Host 头
    init.headers.set('host', 'registry-1.docker.io');

    // 如果是获取清单或 blobs 的请求，添加认证令牌
    if (pathname.includes('/manifests/') || pathname.includes('/blobs/')) {
      const scope = `repository:${imageName}:pull`;
      try {
        const token = await getDockerHubToken(scope);
        init.headers.set('Authorization', `Bearer ${token}`);
      } catch (error) {
        console.error('Failed to get token:', error.message);
        return new Response('Failed to get registry token', { status: 500 });
      }
    }

    // 发送请求到 Docker Registry
    const response = await fetch(targetUrl, init);

    // 如果是重定向 (e.g., 307 for blobs), 手动跟随
    if (response.status >= 300 && response.status < 400 && response.headers.has('location')) {
      const location = response.headers.get('location');
      console.log('Following redirect to:', location);

      // 创建到重定向地址的新请求
      // 注意：我们不应该将 Authorization 头发送到 CDN
      const redirectInit = {
        method: request.method,
        headers: request.headers, // 使用原始请求头
      };

      // 发送到 CDN
      const redirectResponse = await fetch(location, redirectInit);

      // 将响应缓存起来，设置最大缓存时间
      const headers = new Headers(redirectResponse.headers);
      headers.set('cache-control', `public, max-age=${MAX_CACHE_AGE}`);

      if (ENABLE_CACHE) {
        const cachedRedirectResponse = new Response(redirectResponse.body, {
          status: redirectResponse.status,
          statusText: redirectResponse.statusText,
          headers: headers
        });
        
        await cache.put(location, cachedRedirectResponse);
      }
      return redirectResponse;
    }

    // 将响应缓存起来，设置最大缓存时间
    const headers = new Headers(response.headers);
    headers.set('cache-control', `public, max-age=${MAX_CACHE_AGE}`);

    if (ENABLE_CACHE) {
      const cachedResponseToStore = new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: headers
      });
      
      await cache.put(targetUrl, cachedResponseToStore);
    }
    return response;

  } catch (error) {
    console.error('Registry error:', error.message);
    console.error('Registry error stack:', error.stack);
    return new Response(`Registry request failed: ${error.message}`, { 
      status: 500,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}

// 主处理函数 - 符合 ESA Edge Routine 要求的 fetch 函数
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    try {
      // 处理版本请求
      if (pathname === '/version') {
        return new Response(JSON.stringify({ version: VERSION }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200
        });
      }

      // 处理根路径
      if (pathname === '/v2/') {
        return new Response(JSON.stringify({ message: 'ESA Docker Registry Proxy' }), {
          headers: { 'Content-Type': 'application/json' },
          status: 200
        });
      }

      // 处理认证请求
      if (pathname === '/v2/token') {
        return await handleAuth(request);
      }

      // 处理 Registry 请求
      if (pathname.startsWith('/v2/')) {
        return await handleRegistry(request);
      }

      // 其他路径返回404
      return new Response('Not Found', { status: 404 });
    } catch (error) {
      console.error('Handler error:', error.message);
      console.error('Handler error stack:', error.stack);
      return new Response(`Internal Server Error: ${error.message}`, { 
        status: 500,
        headers: { 'Content-Type': 'text/plain' }
      });
    }
  }
}
