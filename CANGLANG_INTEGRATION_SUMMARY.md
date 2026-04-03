# 沧澜平台集成总结

## 功能概述

本次修改为 沧澜 浏览器扩展添加了保存网页到沧澜平台的功能。用户可以选择将处理后的网页自动发送到沧澜平台进行归档。

**核心特性：**
- ✅ 自动跨域 Token 同步（无需手动配置，支持任何页面保存）
- ✅ 智能 Token 同步脚本（实时监听沧澜平台登录状态）
- ✅ **支持 SecureLS 加密 Token**（AES + LZString 压缩，自动解密）
- ✅ 动态 localStorage key 查找（支持不同版本的沧澜平台）
- ✅ 智能检测登录状态，未登录时友好提示
- ✅ 支持普通和压缩内容的保存
- ✅ 完整的错误处理和用户提示

## 修改的文件

### 1. `manifest.json`
**修改内容：** 添加沧澜平台 Token 同步脚本的 content_script 配置

**位置：** 第 14-26 行

**新增配置：**
```json
{
  "matches": [
    "http://192.168.100.100:15666/*",
    "https://192.168.100.100:15666/*"
  ],
  "run_at": "document_idle",
  "js": [
    "lib/chrome-browser-polyfill.js",
    "lib/canglang-token-sync.js"
  ],
  "all_frames": false
}
```

**功能说明：**
- 当用户访问沧澜平台（`http://192.168.100.100:15666/*`）时，自动注入 Token 同步脚本
- 脚本会监听 localStorage 变化，自动将 Token 同步到扩展 storage
- ⚠️ **重要：** 如果沧澜平台的域名或端口发生变化，需要同步修改此配置

---

### 2. `src/core/content/canglang-token-sync.js` & `lib/canglang-token-sync.js`
**新增文件：** Token 跨域同步脚本（支持 SecureLS 加密）

**核心功能：**
1. **支持 SecureLS 加密格式**
   - 自动检测 localStorage 中的数据是否使用 SecureLS 加密
   - 使用 AES 算法解密加密的 Token
   - 支持 LZString 压缩数据的解压缩
   - 兼容明文和加密两种存储格式

2. **动态查找 localStorage key**
   - 使用正则模式匹配：`/^.*-core-access$/`（匹配任何以 `-core-access` 结尾的 key）
   - 支持不同版本的沧澜平台（例如：`沧澜-1.0.0-dev-core-access`）

3. **自动同步 Token 到扩展 storage**
   - 从沧澜平台页面的 localStorage 读取 Token（可能是加密的）
   - 自动解密加密的 Token
   - 将解密后的 Token 保存到 `browser.storage.local` 的 `canglangAuthToken` key
   - 其他页面可以跨域访问扩展 storage 中的 Token

4. **实时监听变化**
   - 监听 localStorage 的 `storage` 事件（跨标签页变化）
   - 监听元数据键变化（SecureLS 用于标记加密状态）
   - 监听页面可见性变化（`visibilitychange`）
   - 定期检查 Token 更新（每 60 秒）

5. **智能去重**
   - 缓存上次同步的 Token，避免重复写入
   - 只在 Token 真正变化时才同步

**SecureLS 加密参数：**
- **加密算法**：AES（Advanced Encryption Standard）
- **加密密钥**：从扩展配置 `canglangSecureKey` 读取（对应后端 `VITE_APP_STORE_SECURE_KEY`）
- **数据压缩**：LZString 压缩（减少存储空间）
- **元数据键**：`${namespace}-secure-meta`（用于标记加密数据）
- **编码方式**：Base64 编码

**加密数据流程：**
```
localStorage (加密) → SecureLS 解密 → 解压缩 → JSON 解析 → 提取 accessToken → 同步到扩展 storage
```

**存储数据结构：**
```javascript
// 存储在 browser.storage.local 中的数据
{
  "canglangAuthToken": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",  // JWT Token（已解密）
    "updatedAt": "2025-12-17T10:30:00.000Z",            // 更新时间
    "source": "沧澜-1.0.0-dev-core-access",              // 来源 key
    "encrypted": true                                    // 数据是否加密
  }
}
```

**关键函数：**
- `initSecureLS()` - 初始化 SecureLS 实例（从扩展配置读取密钥）
- `isDataEncrypted()` - 检测 localStorage 数据是否加密
- `findCanglangStorageKey()` - 查找沧澜平台的 localStorage key
- `syncTokenToExtensionStorage()` - 同步 Token 到扩展 storage（支持加密解密）
- `watchLocalStorageChanges()` - 监听 localStorage 变化

---

### 3. `src/core/bg/config.js`
**修改内容：** 添加沧澜平台配置项

**新增配置项：**
```javascript
// 沧澜平台配置项
saveToCanglang: true,  // 是否保存到沧澜平台（默认启用）
canglangDomain: "http://192.168.100.100:18080",  // 沧澜平台域名（用于 Token 同步和错误提示）
canglangApiUrl: "http://192.168.100.100:18080/api/v1/dynamic-monitor/article/archives",  // 沧澜平台 API 地址
canglangSecureKey: "please-replace-me-with-your-own-key"  // 沧澜平台 localStorage 加密密钥（对应后端 VITE_APP_STORE_SECURE_KEY）
// 注意：
// 1. Token 会自动从沧澜平台页面同步到扩展 storage，无需手动配置
// 2. 用户只需访问沧澜平台并登录一次，扩展会自动监测并同步 Token
// 3. 如果更改 canglangDomain，需要同步修改 manifest.json 中的 content_scripts matches 配置
// 4. canglangSecureKey 用于解密沧澜平台 localStorage 中的加密 Token，请替换为实际密钥（与后端 VITE_APP_STORE_SECURE_KEY 一致）
```

**位置：** 第 204-212 行

**说明：**
- 移除了 `canglangAuthToken` 手动配置项
- Token 会自动从沧澜平台页面同步到扩展 storage
- API URL 更新为 `/api/v1/dynamic-monitor/article/archives`
- 新增 `canglangDomain` 配置，用于错误提示和 Token 同步

---

### 4. `src/core/bg/downloads.js`
**修改内容：** 实现沧澜平台保存功能的核心逻辑

#### 4.1 导出 `saveToCanglang` 函数
**位置：** 第 64-76 行

添加了 `saveToCanglang` 到导出列表。

#### 4.2 创建 `getCanglangTokenFromStorage()` 函数
**位置：** 第 726-747 行

**功能说明：**
- 从扩展 `browser.storage.local` 读取沧澜平台 Token
- Token 由沧澜平台页面的同步脚本自动更新
- 提取 `canglangAuthToken.token` 字段
- 详细的日志输出，便于调试

**函数实现：**
```javascript
async function getCanglangTokenFromStorage() {
	try {
		console.log("[沧澜] 尝试从 storage 读取沧澜平台 Token...");
		const result = await browser.storage.local.get("canglangAuthToken");
		const tokenData = result.canglangAuthToken;

		if (!tokenData || !tokenData.token) {
			console.log("[沧澜] 沧澜平台 Token 未找到，请先登录沧澜平台");
			return null;
		}

		console.log("[沧澜] 成功从扩展 storage 读取沧澜平台 Token");
		console.log("[沧澜] Token 更新时间:", tokenData.updatedAt);
		console.log("[沧澜] Token 来源:", tokenData.source);
		return tokenData.token;
	} catch (error) {
		console.error("[沧澜] 读取沧澜平台 Token 失败:", error);
		return null;
	}
}
```

#### 4.3 创建 `extractDescription()` 辅助函数
**位置：** 第 783-803 行

**功能说明：**
- 从 HTML 内容中提取 meta description
- 使用正则表达式快速提取，无需解析整个 DOM
- 支持 `og:description` 和标准 `description` meta 标签

**提取优先级：**
1. `<meta property="og:description">` (Open Graph)
2. `<meta name="description">` (标准 meta)
3. 如果都没有，返回空字符串

#### 4.4 创建 `saveToCanglang()` 函数
**位置：** 第 805-870 行

**功能说明：**
- 将网页数据发送到沧澜平台的归档 API
- 使用 JWT Token 认证
- 支持取消操作（AbortController）
- 完整的错误处理机制

**函数签名：**
```javascript
async function saveToCanglang(taskId, filename, content, pageUrl, pageTitle, apiUrl, authToken)
```

**请求数据格式（扁平 JSON 结构）：**
```javascript
{
  url: pageUrl,                        // 网页URL（必填）
  page_title: pageTitle,               // 网页标题（必填）
  description: description,            // 网页描述（自动从 meta 标签提取）
  html_content: content                // HTML内容（必填）
}
```

**请求头：**
```javascript
{
  "Content-Type": "application/json",
  "Authorization": `Bearer ${authToken}`  // JWT Token 认证
}
```

#### 4.5 在 `downloadContent()` 函数中集成
**位置：** 第 180-218 行

**功能：**
1. 函数开头提前检查 Token（第 180-187 行）
   ```javascript
   let canglangToken = null;
   if (message.saveToCanglang) {
       canglangToken = await getCanglangTokenFromStorage();
       if (!canglangToken) {
           throw new Error(`未登录沧澜平台，请登录后重试`);
       }
   }
   ```

2. 跳过保存检查时排除沧澜平台（第 191 行）
   - 云端保存不需要检查本地文件冲突

3. 调用 `saveToCanglang` 保存（第 207-218 行）
   ```javascript
   else if (message.saveToCanglang) {
       response = await saveToCanglang(
           message.taskId,
           encodeSharpCharacter(message.filename),
           contents.join(""),
           message.originalUrl,
           message.title,
           message.canglangApiUrl,
           canglangToken
       );
       ui.onEnd(tabId);
   }
   ```

#### 4.6 在 `downloadCompressedContent()` 函数中集成
**位置：** 第 324-394 行

**功能：**
- 与 `downloadContent()` 类似
- 处理压缩内容（ZIP 格式）
- 将 Blob 转换为文本后发送到沧澜平台

---

### 5. `src/core/common/download.js`
**修改内容：** 传递沧澜平台参数到后台脚本

#### 4.1 在消息对象中添加沧澜平台参数
**位置：** 第 124-127 行

```javascript
// 沧澜平台相关参数
saveToCanglang: options.saveToCanglang,           // 是否保存到沧澜平台
canglangApiUrl: options.canglangApiUrl,           // 沧澜平台 API 地址
canglangAuthToken: options.canglangAuthToken,     // JWT Token（从 localStorage 自动读取）
```

#### 4.2 更新压缩内容逻辑
**位置：** 第 141 行

添加 `options.saveToCanglang` 到条件判断中。

#### 4.3 更新非压缩内容逻辑
**位置：** 第 179 行和第 182 行

添加 `options.saveToCanglang` 到条件判断中。

---

## 工作流程架构

### Token 同步流程

```
用户登录沧澜平台
    ↓
Token 存储在沧澜平台页面的 localStorage
（key: 沧澜-1.0.0-dev-core-access）
    ↓
Token 同步脚本自动运行
（注入在沧澜平台页面）
    ↓
Token 同步到扩展 browser.storage.local
（key: canglangAuthToken）
    ↓
用户在任意网页使用 沧澜 保存
    ↓
扩展从 browser.storage.local 读取 Token
    ↓
发送 API 请求到沧澜平台
（携带 Authorization header）
```

### 跨域 Token 访问的实现

**问题：** 浏览器的 localStorage 受同源策略限制，在 example.com 页面无法访问 canglang.com 的 localStorage。

**解决方案：** 使用浏览器扩展的 `browser.storage.local` 作为中介存储：

1. **在沧澜平台页面**：Token 同步脚本将 localStorage 中的 Token 同步到 `browser.storage.local`
2. **在任意网页**：沧澜 从 `browser.storage.local` 读取 Token（跨域访问）
3. **实时同步**：Token 变化时自动更新扩展 storage

---

## API 接口规范

### 接口地址
```
POST http://192.168.100.100:18080/api/v1/dynamic-monitor/article/archives
```

**注意：** API URL 已更新为 `/article/archives`（不是 `/archives`）

### 认证方式
- **必需认证：** 使用 JWT Token 认证，归档绑定到用户账户
- Token 从扩展 storage 自动获取，无需手动配置

### 请求头
```javascript
{
  "Content-Type": "application/json",
  "Authorization": "Bearer [JWT_TOKEN]"  // 必需
}
```

### 请求体（扁平 JSON 结构）
```javascript
{
  "url": "https://example.com",           // 必填：网页URL
  "page_title": "Example Page",           // 必填：页面标题
  "description": "页面描述",               // 必填：页面描述（自动提取）
  "html_content": "<html>...</html>"      // 必填：HTML内容
}
```

**注意：** 请求体已简化为扁平结构，不再使用嵌套的 `content` 对象。

### 响应格式
```javascript
{
  "code": 200,
  "message": "success",
  "data": {
    // 归档详情
  }
}
```

---

## 使用方法

### 步骤 0：配置加密密钥（生产环境必须）

**如果沧澜平台启用了 localStorage 加密（生产环境推荐），需要先配置解密密钥：**

1. **获取加密密钥**
   - 从沧澜平台后端环境变量 `VITE_APP_STORE_SECURE_KEY` 获取密钥
   - 默认值：`please-replace-me-with-your-own-key`
   - 生产环境应使用自定义密钥

2. **配置扩展密钥**
   - 打开 沧澜 扩展的选项/设置页面
   - 找到"沧澜平台加密密钥"配置项（`canglangSecureKey`）
   - 输入与后端一致的密钥
   - 保存设置

**⚠️ 重要提示：**
- 密钥必须与沧澜平台后端 `VITE_APP_STORE_SECURE_KEY` 完全一致
- 如果密钥不正确，Token 解密会失败，无法登录
- 如果沧澜平台未启用加密（开发环境），可以跳过此步骤

### 步骤 1：登录沧澜平台（首次使用必须）

**重要：** 在使用 沧澜 保存到沧澜平台之前，必须先登录沧澜平台：

1. 访问沧澜平台网站：`http://192.168.100.100:15666`
2. 输入用户名和密码登录
3. Token 同步脚本会自动运行，将 Token 同步到扩展 storage

**工作原理：**
- 沧澜平台前端登录后，Token 存储在 localStorage（key: `沧澜-1.0.0-dev-core-access`）
- 沧澜 的 Token 同步脚本自动检测并同步 Token 到扩展 storage
- Token 同步到 `browser.storage.local.canglangAuthToken`
- 其他页面可以跨域访问扩展 storage

**验证 Token 是否同步成功：**
在沧澜平台页面的浏览器控制台，查看以下日志：
```
[沧澜] 沧澜平台 Token 同步脚本已启动
[沧澜] 找到沧澜平台 Token key: 沧澜-1.0.0-dev-core-access
[沧澜] 成功同步沧澜平台 Token 到扩展 storage
```

### 步骤 2：启用沧澜平台保存（可选）

在 沧澜 扩展的设置中：
1. 找到"沧澜平台"设置项
2. 确认"保存到沧澜平台"已勾选（默认启用）
3. API URL 已默认配置，通常无需修改

**默认配置：**
- `saveToCanglang`: `true`（默认启用）
- `canglangApiUrl`: `http://192.168.100.100:18080/api/v1/dynamic-monitor/article/archives`

### 步骤 3：在任意网页保存

1. 在浏览器中打开要保存的网页（**任意网站，不限于沧澜平台**）
2. 点击 沧澜 扩展图标
3. 选择"Save"
4. 沧澜 会自动：
   - 从扩展 storage 读取 Token（跨域访问）
   - 检测登录状态
   - 提取页面内容和 meta description
   - 发送数据到沧澜平台 API
5. 收到浏览器通知："已保存至沧澜平台，请稍后查看"

### 步骤 4：处理登录过期

如果未登录沧澜平台或 Token 已过期：
- 显示错误："未登录沧澜平台，请登录后重试"
- 保存操作会被取消
- 需要访问沧澜平台网站重新登录
- Token 会自动重新同步

---

## 技术特性

### 1. 跨域 Token 同步
- ✅ 使用浏览器扩展 storage 作为中介，实现跨域 Token 访问
- ✅ 动态 localStorage key 查找（支持不同版本的沧澜平台）
- ✅ 实时监听 Token 变化（storage 事件、visibilitychange、定时检查）
- ✅ 智能去重，避免重复写入
- ✅ 支持在任意网站保存网页到沧澜平台

### 2. 自动 Token 管理
- ✅ 自动从扩展 storage 读取 Token（存储键：`canglangAuthToken`）
- ✅ 无需手动配置或复制粘贴 Token
- ✅ 实时检测登录状态
- ✅ Token 自动同步到扩展 storage
- ✅ Token 过期时智能提示用户重新登录

### 3. 认证机制
- ✅ 支持 JWT Token 认证（自动从扩展 storage 获取）
- ✅ 自动在请求头中添加 `Authorization: Bearer {token}`
- ✅ 登录状态智能检测和验证
- ✅ Token 同步脚本实时更新

### 4. 错误处理
- ✅ HTTP 错误状态码处理
- ✅ 网络错误处理
- ✅ 请求取消处理（AbortController）
- ✅ Storage 读取异常处理
- ✅ JSON 解析错误处理
- ✅ 友好的错误消息提示

### 5. 用户体验
- ✅ 零配置（只需登录一次沧澜平台）
- ✅ 浏览器通知提示成功保存
- ✅ 未登录时明确提示："未登录沧澜平台，请登录后重试"
- ✅ 支持取消操作
- ✅ 支持在任意网站保存（不限于沧澜平台域名）
- ✅ 与其他云端保存选项（GDrive、GitHub 等）一致的交互体验

### 6. 安全性
- ✅ Token 仅存储在扩展 storage，不在配置中
- ✅ 利用浏览器扩展的权限模型，实现安全的跨域 Token 访问
- ✅ 遵循浏览器安全策略
- ✅ 减少 Token 泄露风险

### 7. 代码质量
- ✅ 详细的中文注释
- ✅ JSDoc 文档注释
- ✅ 完整的日志输出（便于调试）
- ✅ 错误消息本地化
- ✅ 遵循项目现有代码风格

---

## 测试建议

### 1. Token 同步测试
- [ ] 测试首次登录沧澜平台，Token 自动同步
- [ ] 测试在沧澜平台页面查看同步日志
- [ ] 测试登出后 Token 自动清除
- [ ] 测试 Token 过期后重新登录
- [ ] 测试多个标签页同时修改 Token

### 2. 跨域访问测试
- [ ] 在沧澜平台页面保存网页
- [ ] 在其他网站（如 example.com）保存网页
- [ ] 验证两种情况下都能正确读取 Token

### 3. 功能测试
- [ ] 测试启用沧澜平台保存功能
- [ ] 测试保存普通网页
- [ ] 测试保存压缩内容
- [ ] 测试自动读取 JWT Token 并认证
- [ ] 测试保存成功后的浏览器通知
- [ ] 测试 meta description 自动提取

### 4. 错误场景测试
- [ ] 测试 API 地址错误
- [ ] 测试网络连接失败
- [ ] 测试 API 返回错误状态码
- [ ] 测试取消保存操作
- [ ] 测试未登录时的错误提示
- [ ] 测试 Token 格式错误

### 5. 集成测试
- [ ] 测试与本地保存同时启用
- [ ] 测试与其他云端保存（GDrive、GitHub）同时启用
- [ ] 测试在不同浏览器中的兼容性（Chrome、Firefox、Edge）

### 6. 调试测试
- [ ] 在沧澜平台页面控制台查看同步日志
- [ ] 在其他网页控制台查看保存日志
- [ ] 检查 `browser.storage.local.canglangAuthToken` 数据
- [ ] 验证请求头中的 Authorization 字段

---

## 配置示例

### 默认配置（在 config.js 中）
```javascript
{
  "saveToCanglang": true,  // 启用沧澜平台保存（默认启用）
  "canglangDomain": "http://192.168.100.100:18080",  // 沧澜平台域名
  "canglangApiUrl": "http://192.168.100.100:18080/api/v1/dynamic-monitor/article/archives"  // API 地址
}
```

### manifest.json 中的 Token 同步脚本配置
```json
{
  "matches": [
    "http://192.168.100.100:15666/*",
    "https://192.168.100.100:15666/*"
  ],
  "run_at": "document_idle",
  "js": [
    "lib/chrome-browser-polyfill.js",
    "lib/canglang-token-sync.js"
  ]
}
```

**说明：**
- Token 不再需要手动配置
- 用户只需登录沧澜平台一次，Token 会自动同步
- 如果沧澜平台域名变化，需要同步修改 `manifest.json` 和 `config.js`

---

## Storage 数据结构

### 沧澜平台 localStorage（在沧澜平台页面）

**存储键：** 动态匹配 `/^.*-core-access$/`（例如：`沧澜-1.0.0-dev-core-access`）

**数据结构（由沧澜平台前端存储）：**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "...",
  "userId": "123",
  "username": "user@example.com"
}
```

### 扩展 Storage（browser.storage.local）

**存储键：** `canglangAuthToken`

**数据结构（由 Token 同步脚本存储）：**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "updatedAt": "2025-12-17T10:30:00.000Z",
  "source": "沧澜-1.0.0-dev-core-access"
}
```

### Token 读取流程

1. Token 同步脚本（在沧澜平台页面运行）
   ```javascript
   // 1. 查找 localStorage key
   const key = findCanglangStorageKey(); // "沧澜-1.0.0-dev-core-access"

   // 2. 读取 localStorage
   const storeData = localStorage.getItem(key);
   const parsed = JSON.parse(storeData);
   const accessToken = parsed.accessToken;

   // 3. 同步到扩展 storage
   await browser.storage.local.set({
     canglangAuthToken: {
       token: accessToken,
       updatedAt: new Date().toISOString(),
       source: key
     }
   });
   ```

2. 沧澜（在任意网页运行）
   ```javascript
   // 1. 从扩展 storage 读取 Token
   const result = await browser.storage.local.get("canglangAuthToken");
   const token = result.canglangAuthToken.token;

   // 2. 在 API 请求头中使用
   headers: {
     "Authorization": `Bearer ${token}`
   }
   ```

---

## 未来改进方向

1. **截图功能：** 实现 `snapshot_full` 和 `snapshot_viewport` 字段
2. **PDF 生成：** 实现 `pdf_byte` 字段
3. **批量保存：** 支持一次性保存多个网页到沧澜平台
4. **同步状态：** 显示上传进度和同步状态
5. **历史记录：** 查看已保存到沧澜平台的网页列表
6. **自定义描述：** 允许用户自定义归档描述信息

---

## 注意事项

### ⚠️ 重要提示

1. **必须先登录沧澜平台**
   - 在使用 沧澜 保存到沧澜平台之前
   - 必须至少访问一次沧澜平台网站（`http://192.168.100.100:15666`）并登录
   - Token 会自动同步到扩展 storage

2. **Token 同步脚本**
   - 只在沧澜平台页面（`http://192.168.100.100:15666/*`）自动运行
   - 负责将 localStorage 中的 Token 同步到扩展 storage
   - 首次登录后需要等待脚本运行（通常几秒内完成）

3. **Token 过期问题**
   - Token 有效期由沧澜平台后端控制
   - Token 过期后需要重新登录沧澜平台
   - Token 会自动重新同步，无需手动操作
   - 沧澜 会检测并提示："未登录沧澜平台，请登录后重试"

4. **浏览器隐私模式**
   - 隐私模式下 localStorage 和扩展 storage 可能不持久化
   - 建议在正常模式下使用

5. **跨域 Token 访问**
   - ✅ **解决了跨域问题**：使用扩展 storage 作为中介存储
   - ✅ **支持任意网站**：可以在任何网站保存网页到沧澜平台
   - ✅ **无需同源**：不再受 localStorage 同源策略限制

6. **域名和端口配置**
   - 沧澜平台前端：`http://192.168.100.100:15666`（Token 同步脚本注入）
   - 沧澜平台 API：`http://192.168.100.100:18080`（数据上传）
   - 注意：前端和 API 使用不同的端口

7. **manifest.json 配置**
   - 如果沧澜平台域名或端口变化，需要修改 `manifest.json` 中的 `content_scripts.matches`
   - 同时需要修改 `config.js` 中的 `canglangDomain` 和 `canglangApiUrl`

8. **API 地址**
   - 确保沧澜平台 API 可访问（内网地址需要在同一网络）
   - 默认地址：`http://192.168.100.100:18080/api/v1/dynamic-monitor/article/archives`
   - 注意：API URL 已更新为 `/article/archives`（不是 `/archives`）

9. **CORS 配置**
   - 确保沧澜平台 API 允许浏览器扩展的跨域请求
   - 需要配置正确的 CORS 响应头

10. **数据大小**
    - 大型网页可能需要较长的上传时间
    - 建议测试大文件上传的超时处理

11. **调试日志**
    - 在沧澜平台页面查看 Token 同步日志
    - 在任意网页查看保存日志
    - 沧澜 会输出详细的调试信息：
      - `[沧澜插件] 沧澜平台 Token 同步脚本已启动`
      - `[沧澜插件] 数据加密状态: 已加密` 或 `明文`
      - `[沧澜插件] SecureLS 初始化成功`
      - `[沧澜插件] 成功解密 Token 数据`
      - `[沧澜插件] 成功同步沧澜平台 Token 到扩展 storage`

---

## 安装和构建

### 依赖要求

**新增依赖：**
- `secure-ls` - 用于解密沧澜平台 localStorage 中的加密 Token

### 安装步骤

1. **安装 npm 依赖**
   ```bash
   npm install secure-ls --save
   ```

2. **构建扩展**
   ```bash
   npm run build
   # 或者
   ./build-extension.sh
   ```

3. **验证构建**
   - 检查 `lib/canglang-token-sync.js` 是否生成
   - 文件应该包含 SecureLS 相关代码

### Rollup 配置

Token 同步脚本的打包配置已添加到 `rollup.config.js`：

```javascript
{
  input: ["src/core/content/canglang-token-sync.js"],
  output: [{
    file: "lib/canglang-token-sync.js",
    format: "iife",
    plugins: [terser()]
  }],
  plugins: PLUGINS
}
```

**说明：**
- 使用 IIFE 格式，确保脚本在浏览器中正确运行
- 使用 `@rollup/plugin-node-resolve` 打包 `secure-ls` 依赖
- 使用 `terser` 压缩代码

---

## 调试指南

### 1. 检查 Token 是否同步到扩展 storage

在沧澜平台页面（`http://192.168.100.100:15666`）的浏览器控制台执行：

```javascript
// 检查沧澜平台 localStorage
for (let i = 0; i < localStorage.length; i++) {
  const key = localStorage.key(i);
  if (key.includes('core-access')) {
    console.log('Found key:', key);
    console.log('Data:', localStorage.getItem(key));
  }
}

// 检查扩展 storage（需要在后台页面控制台执行）
browser.storage.local.get('canglangAuthToken').then(result => {
  console.log('Extension storage:', result);
});
```

### 2. 查看 Token 同步日志

在沧澜平台页面的控制台，应该看到：

**明文 Token（开发环境）：**
```
[沧澜插件] 沧澜平台 Token 同步脚本已启动
[沧澜插件] 当前页面: http://192.168.100.100:15666/...
[沧澜插件] 数据加密状态: 明文
[沧澜插件] 成功同步沧澜平台 Token 到扩展 storage
[沧澜插件] Token 前缀: eyJhbGciOiJIUzI1NiI...
[沧澜插件] 数据加密: 否
```

**加密 Token（生产环境）：**
```
[沧澜插件] 沧澜平台 Token 同步脚本已启动
[沧澜插件] 当前页面: http://192.168.100.100:15666/...
[沧澜插件] 数据加密状态: 已加密
[沧澜插件] SecureLS 初始化成功，命名空间: 沧澜-1.0.0-prod
[沧澜插件] 成功解密 Token 数据
[沧澜插件] 成功同步沧澜平台 Token 到扩展 storage
[沧澜插件] Token 前缀: eyJhbGciOiJIUzI1NiI...
[沧澜插件] 数据加密: 是
```

**解密失败（密钥错误）：**
```
[沧澜插件] 沧澜平台 Token 同步脚本已启动
[沧澜插件] 数据加密状态: 已加密
[沧澜插件] SecureLS 初始化成功
[沧澜插件] SecureLS 解密失败: Error: ...
[沧澜插件] 请检查加密密钥是否正确配置
```

### 3. 查看保存日志

在任意网页保存时，在控制台应该看到：

```
[沧澜] 尝试从 storage 读取沧澜平台 Token...
[沧澜] Storage 返回结果: {canglangAuthToken: {...}}
[沧澜] 成功从扩展 storage 读取沧澜平台 Token
[沧澜] Token 更新时间: 2025-12-17T10:30:00.000Z
[沧澜] Token 来源: 沧澜-1.0.0-dev-core-access
```

### 4. 检查 API 请求

在浏览器开发者工具的 Network 标签中：

1. 找到发送到 `http://192.168.100.100:18080/api/v1/dynamic-monitor/article/archives` 的请求
2. 检查 Request Headers 中的 `Authorization: Bearer ...`
3. 检查 Request Payload 中的数据结构（应该是扁平 JSON）

---

## 联系方式

如有问题或建议，请联系开发团队。

---

**最后更新日期：** 2025-12-17
**版本：** 3.0.0

---

## 版本历史

### v4.0.0 (2026-04-01) - Chrome 127+ (MV3) 全面兼容
- 🎉 **重磅架构升级**：支持最新的 Chrome 127+ (Manifest V3)
- ✅ 引入 **Offscreen Document（离屏文档）** 架构解决 Service Worker DOM 权限限制
- ✅ 实现剪贴板操作 (`saveToClipboard`) 的离屏转发，确保 MV3 下功能完整
- ✅ 同步集成沧澜平台 Token 同步机制到 MV3 环境
- ✅ 新增多环境构建目标：`singlefile-extension-chrome-127+.zip`

### v3.0.0 (2025-12-17) - 跨域 Token 同步架构
- 🎉 **重大架构变更**：实现跨域 Token 同步机制
- ✅ 添加 Token 同步脚本（`canglang-token-sync.js`）
- ✅ 使用扩展 storage 作为中介存储，突破同源策略限制
- ✅ 支持在任意网站保存网页到沧澜平台
- ✅ 动态 localStorage key 查找（支持不同版本沧澜平台）
- ✅ 实时监听 Token 变化（storage 事件、visibilitychange、定时检查）
- ✅ 智能去重，避免重复写入
- ✅ 更新 API URL 为 `/article/archives`（扁平 JSON 结构）
- ✅ 添加 `canglangDomain` 配置项
- ✅ 移除旧的 `content.js` 中的 Token 读取逻辑
- ✅ 改为从扩展 storage 读取 Token

### v2.0.0 (2025-12-17)
- ✅ 实现自动从 localStorage 读取 Token
- ✅ 移除手动配置 Token 的选项
- ✅ 添加智能登录状态检测
- ✅ 添加未登录提示："检测到沧澜平台没有登录，请登录后重试"
- ✅ 优化用户体验（零配置）
- ✅ 增强安全性（Token 不存储在扩展中）

### v1.0.0 (2025-12-16)
- ✅ 初始实现沧澜平台保存功能
- ✅ 支持手动配置 Token
- ✅ 支持普通和压缩内容保存
- ✅ 浏览器通知提示

---

## 总结

本次集成实现了一个**完整的跨域 Token 同步机制**，解决了浏览器扩展在不同域名下访问认证信息的难题。通过使用浏览器扩展的 `browser.storage.local` 作为中介存储，成功实现了：

1. **零配置**：用户只需登录沧澜平台一次
2. **跨域访问**：在任意网站都能保存网页到沧澜平台
3. **自动同步**：Token 变化时自动更新
4. **安全可靠**：遵循浏览器安全策略

这是一个典型的浏览器扩展跨域数据共享解决方案，可作为类似场景的参考实现。
