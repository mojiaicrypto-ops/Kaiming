# kaiming

开明的 Server 与浏览器外壳。安装、启动、模型配置和备份说明在仓库根目录：

- [README](../README.md) — 项目概览与快速开始
- [安装与启动](../docs/install.md) — 环境、数据目录、模型、MCP 与故障排查
- [技术设计](../docs/technicalnew/README.md) — 实现契约与验证入口

## 开发命令

```bash
npm ci
npm --prefix webapp ci
npm run build
npm start

npm test
npm --prefix webapp test
npm run typecheck
npm --prefix webapp run typecheck
npm run test:browser
`npm start` 读取本目录的 `.env`。没有 `.env` 时需自行提供环境变量；缺少 `KAIMING_ACCESS_PASSWORD` 时服务端直接退出。真实模型检查使用独立的 `config/model.json`，它与服务端模型配置无关：


```bash
cp config/model.example.json config/model.json
npm run check:model
npm run check:runtime
```
