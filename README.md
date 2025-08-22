# ESA Docker Registry Proxy

这是一个基于 Alibaba ESA (Edge Security Acceleration) 的 Docker Registry 转发代理，为中国大陆用户提供更快的 Docker 镜像下载服务，并实现镜像白名单功能以增强安全性。

<!--
## 注意

ESA毕竟是阿里云的产品, 对被当作梯子用非常敏感.  

### 2025-06-30 更新
经过实测, 三种区域设置"全球(不含中国), 全球(含中国), 中国"中, 仅设置区域为"**全球(不含中国)**", 才能使本项目正常运行.
**只要区域设置中包含中国, ESA就不能顺利转发海外流量.**
边缘函数设置成功转发后, 速度较慢, 勉强能用.

### 2025-08-22 更新
阿里云国际版禁用了全球(不含中国), 仅能设置"**全球(不含中国)**, **全球(含中国)**", 目前实测已经可以正常速度中转代理docker.
-->

## 功能特性

1. **Docker Registry 代理**: 转发 Docker Hub 请求，提升中国大陆用户下载速度
2. **镜像白名单**: 限制只能下载指定的镜像，提高安全性
3. **支持多种匹配模式**: 支持精确匹配和前缀匹配
4. **支持缓存机制**: 默认**未使用**缓存数据，按需开启

## 快速开始

## 部署到 Alibaba ESA

![演示](演示.webp)

- 登录阿里云 ESA 控制台
- 进入边缘函数(EdgeRoutine)管理页面
- 点击"创建函数"
- 填写以下信息:
  - 函数名称: esa-registry-proxy
  - 描述: Docker Registry Proxy using Alibaba ESA
- 上传代码:
  - 直接粘贴 src/index.js 的内容
- 部署函数
- 绑定自定义域名或路由

## 白名单功能

白名单功能是本项目的核心安全特性，可以限制允许通过代理拉取的 Docker 镜像，防止恶意使用。

### 白名单配置格式

白名单配置为逗号分隔的字符串，每个字符串代表一个允许下载的镜像名称模式:

```env
WHITELIST=library/nginx,library/redis,library/*
```

### 支持的匹配模式

- **精确匹配**: 如 `library/nginx`，只允许下载完全匹配的镜像
- **前缀匹配**: 如 `jqknono/*`，允许下载所有 `jqknono` 组织的镜像

### 配置示例

```env
# 只允许官方nginx和redis镜像
WHITELIST=library/nginx,library/redis

# 允许所有官方镜像
WHITELIST=library/*

# 允许特定组织的所有镜像
WHITELIST=jqknono/*
```

## 使用方式

### 直接使用

```bash
docker pull registry.jqknono.com/library/nginx
```

### 配置 Docker 客户端

在 Docker 配置中添加镜像仓库:

```json
{
  "registry-mirrors": ["https://registry.jqknono.com"]
}
```

## 技术实现

- 利用 Alibaba ESA 的边缘网络加速镜像拉取
- 支持 Docker Registry v2 API
- 实现镜像白名单安全控制
- 利用 ESA Cache API 实现智能缓存，优先使用缓存数据，缓存时间为服务允许的最大值（一个月）

## 注意事项

- 此项目主要用于个人开发环境或小型团队使用
- 大规模生产环境建议使用专业的镜像仓库服务
- 请确保您的 Alibaba ESA 账户有足够的配额

## 参考

- [边缘安全加速 ESA 开发参考](https://www.alibabacloud.com/help/zh/edge-security-acceleration/esa/api-reference-1-1/)
- [边缘函数 API](https://www.alibabacloud.com/help/zh/edge-security-acceleration/esa/user-guide/api-documentation/)
- [repo: alibabacloud-esa-cli](https://github.com/aliyun/alibabacloud-esa-cli)
- [repo: cloudflare-registry-proxy](https://github.com/jqknono/cloudflare-registry-proxy)
- [赞助: NullPrivate - 你的私人 DNS 服务](https://www.nullprivate.com)
- [jqknono的博客](https://blog.jqknono.com/)
