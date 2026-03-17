# Archived due to docker.io 504
# ESA Docker Registry Proxy

这是一个部署在 Alibaba ESA (Edge Security Acceleration) 上的 Docker Registry 代理。

当前版本只保留**纯直连模式**：

- `manifest` 直接代理到 upstream
- `blob` 保持 Docker Hub 的 `307` 跳转语义
- `auth` 保持 Docker Registry 标准 challenge，由客户端直连上游 token 服务
- 不依赖 OSS
- 不依赖预热脚本
- 不依赖外部缓存或索引

## 为什么这样更快

旧版实现会在 ESA 函数里手动跟随 Docker Hub 的 `307`，导致大层文件继续经 ESA 中转。这样会带来：

- 首次 `docker pull` 大文件慢
- ESA 函数执行时长和带宽压力大
- blob 请求可能把不该透传的请求头带到下游对象存储

现在的运行时行为是：

1. `GET /v2/`：透传上游 Registry 的标准 `401` challenge
2. `GET/HEAD /v2/<image>/manifests/<reference>`：直接代理到 upstream
3. `GET/HEAD /v2/<image>/blobs/<digest>`：优先保留上游 `307` 跳转
4. 普通 registry API 请求直接透传 upstream

## 功能特性

- Docker Registry v2 代理
- 镜像白名单控制
- 纯直连代理模式
- manifest 小对象短缓存

## 目录说明

- `src/index.js`：ESA 边缘函数入口

## 配置方式

不再使用环境变量。

请直接修改 `src/index.js` 顶部的 `CONFIG` 常量配置区：

- `whitelist`
- `enableManifestCache`
- `manifestCacheTtl`
- `enableDebugEndpoint`

### 关键说明

- **上游已锁定为 Docker Hub 官方** (`registry-1.docker.io`)，代码中不提供任何 profile 切换或上游覆盖能力
- `UPSTREAM` 常量使用 `Object.freeze()` 冻结，运行时无法被修改
- `whitelist`：允许拉取的镜像列表，支持 `library/*` 这种前缀匹配
- `enableManifestCache`：是否启用 manifest 短缓存
- `manifestCacheTtl`：manifest 缓存秒数
- `enableDebugEndpoint`：是否保留基础调试能力

### 上游说明

上游固定为 Docker Hub 官方 Registry：

| 配置项 | 值 |
| --- | --- |
| Registry Host | `registry-1.docker.io` |
| Auth URL | `https://auth.docker.io/token` |
| Auth Service | `registry.docker.io` |

不支持切换到 DaoCloud 或其他镜像站。如需使用其他上游，必须修改源码中的 `UPSTREAM` 常量并重新部署。

## 使用 ESA CLI 发布

### 前置条件

1. 安装 ESA CLI：`npm install -g esa-cli`
2. 登录：`esa login`
3. 在仓库根目录执行命令，确保存在 [esa.toml](/home/test/code/esa-registry-proxy/esa.toml)
4. 发布前先检查 [src/index.js](/home/test/code/esa-registry-proxy/src/index.js) 顶部 `CONFIG` 是否符合目标环境

### 发布到 Stage

```bash
esa deploy --environment staging
```

推荐发布后立即检查：

```bash
esa deployments list
curl https://registry.jqknono.com/version
curl -i https://registry.jqknono.com/v2/
docker pull registry.jqknono.com/library/nginx:latest
```

### 发布到 Production

确认 `staging` 已验证通过后，再执行：

```bash
esa deploy --environment production
```

推荐发布后立即检查：

```bash
esa deployments list
curl https://esa-registry-proxy.a4565ffd.er.aliyun-esa.net/version
curl -i https://esa-registry-proxy.a4565ffd.er.aliyun-esa.net/v2/
docker pull <你的生产域名>/library/nginx:latest
```

### 查看当前部署版本

```bash
esa deployments list
```

输出里会分别显示 `Staging` 和 `Production` 的活动版本号。

### 回滚方式

若刚发布的版本有问题，先用 `esa deployments list` 记录当前活动版本和可回退版本。

这个 README 只覆盖“发布当前工作区代码”。如果你需要精确回滚到某个旧 code version，建议在 ESA 控制台或你当前使用的 CLI 版本管理命令里重新激活目标版本，再按上面的验证命令检查。

## 旧版部署流程

1. 登录阿里云 ESA 控制台
2. 创建或更新边缘函数
3. 部署 `src/index.js`
4. 按需修改 `src/index.js` 顶部配置常量
5. 绑定域名，例如 `registry.jqknono.com`

## 使用方式

```bash
docker pull registry.jqknono.com/library/nginx:latest
```

## 验证建议

- `GET /v2/` 应返回 Docker Registry 标准 `401` 与 `WWW-Authenticate`
- `latest` / `manifest` / `blob` 都应正常透传 upstream
- blob 请求应返回 `307` 并保持上游跳转
- 非白名单镜像仍返回 `403`

## 注意事项

- 当前实现不再包含 OSS、预热、外部缓存、索引切换相关逻辑
- 行为更简单，但所有流量都会回到 Docker Hub 或其下游跳转地址
