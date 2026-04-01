# 沧澜 扩展部署指南

## 项目简介

沧澜 是一个浏览器扩展，可以将网页保存为单个 HTML 文件。本项目已集成沧澜平台支持。

- **版本**: 1.22.92
- **许可证**: AGPL-3.0-or-later
- **支持浏览器**: Firefox, Chrome/Chromium

---

## 环境要求

### 系统要求
- **操作系统**: Linux/macOS/Windows
- **Node.js**: 推荐 v16+
- **npm**: 推荐 v8+

### 必需工具
- `zip` - 用于打包扩展
- `jq` - JSON 处理工具（Linux/macOS）
- `git` - 版本控制

---

## 快速开始

### 1. 克隆项目

```bash
git clone https://github.com/gildas-lormeau/沧澜.git
cd 沧澜
```

### 2. 安装依赖

```bash
npm install
```

### 3. 开发模式（开发者）

```bash
npm run dev
```

这将启动 Rollup 监听模式，自动重新编译更改。

### 4. 生产构建

```bash
npm run build
```

或直接运行：

```bash
./build-extension.sh
```

---

## 构建流程详解

### 构建脚本做了什么？

`build-extension.sh` 执行以下步骤：

1. **检查并安装依赖工具**
   - 检查 `zip` 和 `jq` 是否安装
   - 如果缺失，自动安装（需要 sudo）

2. **安装 npm 依赖**
   ```bash
   npm install
   npm update
   ```

3. **使用 Rollup 打包代码**
   ```bash
   npx rollup -c rollup.config.js
   ```

   打包生成的文件：
   - `lib/single-file.js` - 核心库
   - `lib/single-file-frames.js` - Frames 处理
   - `lib/single-file-bootstrap.js` - 启动代码
   - `lib/single-file-hooks-frames.js` - Hooks
   - 其他扩展相关文件

4. **生成源代码压缩包**
   ```bash
   zip -r singlefile-extension-source.zip \
     manifest.json package.json _locales src rollup*.js .eslintrc.js build-extension.sh
   ```

5. **生成 Firefox 扩展包**
   - 修改配置（启用 WebAuth 强制流程）
   - 禁用 Companion 功能
   - 打包为 `singlefile-extension-firefox.zip`

### 输出文件

构建完成后，会生成：

- `singlefile-extension-source.zip` - 源代码包（用于提交商店）
- `singlefile-extension-firefox.zip` - Firefox 扩展包（可直接安装）
- `lib/` 目录下的编译文件

---

## 浏览器安装

### Firefox 安装

#### 方法 1: 临时加载（开发测试）

1. 打开 Firefox
2. 访问 `about:debugging#/runtime/this-firefox`
3. 点击 "临时加载附加组件"
4. 选择项目根目录下的 `manifest.json`

#### 方法 2: 安装 .zip 文件

1. 构建生成 `singlefile-extension-firefox.zip`
2. 访问 `about:addons`
3. 点击齿轮图标 → "从文件安装附加组件"
4. 选择 `.zip` 文件

### Chrome/Edge 安装

#### 开发者模式加载

1. 打开 Chrome/Edge
2. 访问 `chrome://extensions/` 或 `edge://extensions/`
3. 启用 "开发者模式"
4. 点击 "加载已解压的扩展程序"
5. 选择项目根目录

---

## 沧澜平台集成配置

### 启用沧澜平台保存

1. **安装扩展后，打开选项页面**
   - Firefox: 右键扩展图标 → 选项
   - Chrome: 右键扩展图标 → 选项

2. **配置沧澜平台参数**

   在选项页面中找到"沧澜平台"设置区域：

   - **沧澜平台 API 地址**:
     ```
     https://your-canglang-server.com/api/save
     ```

   - **JWT 认证令牌**（可选）:
     ```
     eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
     ```

3. **测试保存**
   - 访问任意网页
   - 点击 沧澜 扩展图标
   - 选择"保存到沧澜平台"
   - 查看浏览器通知确认保存成功

### 沧澜平台 API 要求

后端 API 应接收以下参数（扁平 JSON 结构）：

```json
{
  "url": "https://example.com",
  "page_title": "Example Page",
  "description": "这是页面的 meta description，如果页面没有则使用默认描述",
  "html_content": "<html>...</html>",
  "snapshot_full": null,
  "snapshot_viewport": null,
  "pdf_byte": null
}
```

**参数说明**：
- `url`: 网页URL（必填）
- `page_title`: 网页标题（必填）
- `description`: 网页描述（自动提取）
  - 优先从 `<meta property="og:description">` 提取
  - 其次从 `<meta name="description">` 提取
  - 如果都没有，使用默认值："由 沧澜 扩展自动归档于 [时间]"
- `html_content`: HTML内容（必填）
- `snapshot_full`: 完整截图Base64编码（前端发送 null，**建议由后端生成**）
- `snapshot_viewport`: 视口截图Base64编码（前端发送 null，**建议由后端生成**）
- `pdf_byte`: PDF数据Base64编码（前端发送 null，**建议由后端生成**）

**后端生成截图和 PDF 的建议**：

前端发送完整的 HTML 内容后，后端可以使用以下工具生成截图和 PDF：

```python
# Python 示例 - 使用 Playwright
from playwright.async_api import async_playwright
import base64

async def generate_assets(html_content: str, url: str):
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page()

        # 加载 HTML
        await page.set_content(html_content, wait_until="networkidle")

        # 生成截图
        screenshot_bytes = await page.screenshot(full_page=True)
        screenshot_base64 = base64.b64encode(screenshot_bytes).decode()

        # 生成 PDF
        pdf_bytes = await page.pdf(format='A4')
        pdf_base64 = base64.b64encode(pdf_bytes).decode()

        await browser.close()

        return screenshot_base64, pdf_base64
```

请求头（如果配置了 Token）：
```
Authorization: Bearer <JWT_TOKEN>
```

响应示例：
```json
{
  "success": true,
  "message": "保存成功",
  "url": "https://canglang.com/saved/123"
}
```

---

## 项目结构

```
沧澜/
├── manifest.json          # 浏览器扩展清单文件
├── package.json           # npm 项目配置
├── build-extension.sh     # 构建脚本
├── rollup.config.js       # Rollup 打包配置
├── rollup.config.dev.js   # 开发模式配置
│
├── src/                   # 源代码
│   ├── core/              # 核心功能
│   │   ├── bg/            # 后台脚本
│   │   │   ├── downloads.js      # 下载逻辑（含沧澜集成）
│   │   │   ├── business.js       # 业务逻辑
│   │   │   └── config.js         # 配置管理
│   │   └── content/       # 内容脚本
│   │
│   ├── lib/               # 第三方库
│   │   ├── canglang/      # 沧澜平台 SDK
│   │   ├── gdrive/        # Google Drive
│   │   ├── dropbox/       # Dropbox
│   │   └── ...
│   │
│   └── ui/                # 用户界面
│       ├── bg/            # 后台 UI 逻辑
│       └── pages/         # HTML 页面
│
├── lib/                   # 编译输出目录
│   ├── single-file.js
│   ├── single-file-frames.js
│   └── ...
│
└── _locales/              # 国际化翻译文件
    ├── en/
    ├── zh_CN/
    └── ...
```

---

## 开发指南

### 修改代码后重新构建

1. **修改源代码**（例如 `src/core/bg/downloads.js`）

2. **重新构建**
   ```bash
   npm run build
   ```

3. **重新加载扩展**
   - Firefox: `about:debugging` → 重新加载
   - Chrome: `chrome://extensions/` → 刷新图标

### 调试技巧

1. **查看后台脚本日志**
   - Firefox: `about:debugging` → 检查（Inspect）
   - Chrome: `chrome://extensions/` → 背景页（Service Worker）

2. **查看内容脚本日志**
   - 打开网页的浏览器控制台（F12）

3. **查看网络请求**
   - 浏览器开发者工具 → Network 标签
   - 过滤沧澜平台 API 请求

---

## 常见问题

### 1. 构建失败：找不到 `zip` 命令

**解决方案**:
```bash
# Ubuntu/Debian
sudo apt install zip

# macOS
brew install zip

# Windows
# 使用 Git Bash 或安装 zip 工具
```

### 2. 构建失败：找不到 `jq` 命令

**解决方案**:
```bash
# Ubuntu/Debian
sudo apt install jq

# macOS
brew install jq

# Windows
# 下载 jq.exe 并添加到 PATH
```

### 3. Firefox 无法加载扩展

**检查**:
- 确保 `manifest.json` 存在
- 检查浏览器版本是否支持 Manifest V2
- 查看 `about:debugging` 中的错误信息

### 4. 沧澜平台保存失败

**排查步骤**:
1. 检查 API 地址是否正确
2. 检查网络连接
3. 打开浏览器控制台查看错误信息
4. 验证 JWT Token 是否有效
5. 确认后端 API 是否正常运行

### 5. 编译后文件未更新

**解决方案**:
```bash
# 清理并重新构建
rm -rf lib/
npm run build

# 或清理 node_modules 重新安装
rm -rf node_modules/
npm install
npm run build
```

---

## 生产部署

### 发布到 Firefox Add-ons

1. 访问 https://addons.mozilla.org/developers/
2. 上传 `singlefile-extension-firefox.zip`
3. 提供源代码包 `singlefile-extension-source.zip`
4. 填写变更说明
5. 等待审核

### 发布到 Chrome Web Store

1. 访问 https://chrome.google.com/webstore/devconsole/
2. 打包 `.crx` 文件或上传 `.zip`
3. 填写商店详情
4. 支付一次性开发者费用（$5）
5. 提交审核

---

## 版本管理

### 更新版本号

1. **修改 `manifest.json`**
   ```json
   {
     "version": "1.22.93"
   }
   ```

2. **修改 `package.json`**
   ```json
   {
     "version": "1.2.5"
   }
   ```

3. **提交并打标签**
   ```bash
   git add manifest.json package.json
   git commit -m "Bump version to 1.22.93"
   git tag v1.22.93
   git push origin master --tags
   ```

4. **重新构建**
   ```bash
   npm run build
   ```

---

## 技术栈

- **核心库**: single-file-core (v1.5.76)
- **打包工具**: Rollup (v4.53.3)
- **代码压缩**: Terser
- **代码规范**: ESLint (v9.39.1)
- **浏览器 API**: WebExtensions API
- **Manifest 版本**: Manifest V2

---

## 许可证

本项目采用 AGPL-3.0-or-later 许可证。

---

## 支持与反馈

- **项目主页**: https://www.getsinglefile.com
- **GitHub**: https://github.com/gildas-lormeau/沧澜
- **问题反馈**: GitHub Issues

---

## 相关文档

- [沧澜平台集成总结](CANGLANG_INTEGRATION_SUMMARY.md)
- [FAQ](faq.md)
- [已知问题](known-issues.md)
- [隐私政策](privacy.md)
- [贡献者](contributors.md)

---

**最后更新**: 2025-12-17
