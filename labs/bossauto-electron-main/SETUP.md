# 新电脑部署 / 迁移

## 一句话
```
git clone <仓库地址> && cd bossauto-electron && npm install
```
`npm install` 会自动:安装依赖 → 安装浏览器内核(patchright chromium)→ 部署默认筛选配置(项目"新媒体运营")。

## 之后两步
1. 复制 `.env.example` 为 `.env`,填入 `DEEPSEEK_API_KEY`(判定必需;密钥不入库,需手动填一次)。
2. `npm run dev` 启动;首次需扫码登录 BOSS。

启动后:把要跑的页(推荐/搜索)切到前台 → 点开始,程序自动按当前页执行(推荐→打招呼、搜索→收藏)。

## 关于"已打招呼/收藏记录"(防重复骚扰)
该记录是候选人隐私 + 运行时数据,**不入库**,新电脑默认从空开始。
如需沿用旧机记录避免重复打招呼,把旧机的
`%AppData%\bossauto-electron\contacted.json`
拷到新机同一位置即可(单独拷,不走 git)。

## 重新部署默认配置
运行时已有配置时 `npm install` 不会覆盖。如需强制还原:删除
`%AppData%\bossauto-electron\projects\` 后再 `npm run setup`。
