# ESA Registry Proxy 部署说明

## 项目信息

- 项目名称: esa-registry-proxy
- 描述: Docker Registry Proxy using Alibaba ESA with caching support
- 入口文件: src/index.js

## 部署步骤

- 登录阿里云 ESA 控制台
- 进入边缘函数(EdgeRoutine)管理页面
- 点击"创建函数"
- 填写以下信息:
  - 函数名称: esa-registry-proxy
  - 描述: Docker Registry Proxy using Alibaba ESA
- 上传代码:
  - 上传文件: esa-registry-proxy/src/index.js
  - 或者直接粘贴 src/index.js 的内容
- 部署函数
- 绑定自定义域名或路由

## 本地测试

您可以在本地测试函数:

```bash
cd esa-registry-proxy
esa dev
```

## 使用方式

部署成功后，您可以使用以下方式访问:

```bash
# 拉取镜像
docker pull registry.jqknono.com/jqknono/weread-challenge:latest
docker pull registry.jqknono.com/adguardprivate/adguardprivate:latest


# 或配置 Docker daemon 使用镜像仓库
# 在 /etc/docker/daemon.json 中添加:
{
  "registry-mirrors": [
    "https://registry.jqknono.com"
  ]
}
```

## 缓存说明

本代理实现了智能缓存机制，会优先使用缓存的数据来响应请求，从而提高响应速度并减少对 Docker Hub 的重复请求。缓存时间设置为一个月，确保在缓存有效期内尽可能复用已缓存的数据。
