# 生产部署指南

## 架构

```
收银机（Windows + Electron 桌面端）
        │ HTTPS
        ▼
云服务器（Docker Compose）：API (NestJS) + PostgreSQL + Caddy(可选, TLS)
```

## 1. 服务器准备

- 推荐配置：2 核 4G 云服务器（国内厂商，单店日单量 < 1k 完全够用）
- 安装 Docker 与 Docker Compose
- 安全组仅放行 80/443（API 不直接暴露 3000）

## 2. 部署 API 与数据库

服务器上创建 `~/stationery-pos/`：

```bash
git clone https://github.com/SchearLoe/stationery-pos.git
cd stationery-pos
```

创建 `apps/server/.env`：

```ini
DATABASE_URL="postgresql://pos:<强密码>@postgres:5432/stationery_pos"
JWT_SECRET="<openssl rand -hex 32 生成>"
JWT_EXPIRES=43200
PORT=3000
```

使用仓库提供的生产 compose（`docker compose -f deploy/docker-compose.prod.yml up -d`）或手动：

```bash
docker run -d --name pos-db \
  -e POSTGRES_USER=pos -e POSTGRES_PASSWORD=<强密码> -e POSTGRES_DB=stationery_pos \
  -v pos_pgdata:/var/lib/postgresql/data \
  --restart unless-stopped postgres:16-alpine

cd apps/server
pnpm install && pnpm build
pnpm db:deploy     # 应用迁移（生产用 deploy，不用 migrate dev）
pnpm db:seed       # 首次初始化账号
node dist/main.js  # 或用 pm2 / systemd 托管
```

推荐用 pm2 守护：

```bash
npm i -g pm2
pm2 start dist/main.js --name pos-api
pm2 save
```

## 3. 反向代理 + HTTPS

用 Caddy（自动签发证书）：

```
pos-api.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

## 4. 数据备份（重要）

数据库每日备份到对象存储（以 OSS 为例）：

```bash
# crontab：每天 03:00 备份
0 3 * * * docker exec pos-db pg_dump -U pos stationery_pos | gzip > ~/backup/pos_$(date +\%F).sql.gz && ossutil cp -f ~/backup/pos_$(date +\%F).sql.gz oss://your-bucket/pos-backup/
```

保留策略：本地 7 天、云端 30 天。

## 5. 桌面端安装

```bash
cd apps/desktop
pnpm dist        # 产出 release/文具店收银系统-Setup-x.x.x.exe
```

安装到收银机后，首次进入「系统设置 → 服务器地址」填入 `https://pos-api.example.com/api`。

## 6. 上线检查清单

- [ ] 修改 boss / cashier 默认密码
- [ ] JWT_SECRET 已更换为随机值
- [ ] 数据库密码为强密码，5432 端口未对公网开放
- [ ] HTTPS 生效（收银端与 API 之间）
- [ ] 备份定时任务已配置并验证可恢复
- [ ] 期初数据导入完成（商品管理 → CSV 导入）
- [ ] 扫码枪、小票打印机联调通过
- [ ] 交接班流程试运行一天
