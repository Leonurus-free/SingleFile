/*
 * 沧澜平台 Token 同步脚本 - 支持 SecureLS 加密
 *
 * 此脚本专门用于在沧澜平台页面运行，自动将 localStorage 中的认证 Token
 * 同步到浏览器扩展的 storage 中，使得其他页面也能跨域访问该 Token。
 *
 * 支持特性：
 * - 兼容 SecureLS 加密格式（AES + LZString 压缩）
 * - 自动检测明文或加密数据
 * - 动态读取加密密钥配置
 *
 * 工作原理：
 * 1. 在沧澜平台页面加载时，读取 localStorage 中的 Token（可能是加密的）
 * 2. 使用 SecureLS 解密 Token（如果已加密）
 * 3. 将解密后的 Token 保存到 browser.storage.local（扩展的存储空间）
 * 4. 监听 localStorage 变化，自动同步最新的 Token
 */

/* global browser, localStorage, SecureLS */

// 沧澜平台可能使用的 localStorage key 模式
// 格式：${namespace}-core-access
// 例如：沧澜-1.0.0-dev-core-access
const POSSIBLE_KEY_PATTERNS = [
	/^.*-core-access$/,  // 匹配任何以 -core-access 结尾的 key
	/^沧澜-.*-core-access$/  // 匹配沧澜平台专用的 key
];

// 元数据键（SecureLS 用于标记加密数据）
const SECURE_META_KEY_PATTERN = /^.*-secure-meta$/;

// 扩展 storage 中存储的 key
const STORAGE_KEY = "canglangAuthToken";

// 缓存最后一次同步的 Token，避免重复写入
let lastSyncedToken = null;

// SecureLS 实例（延迟初始化）
let secureLS = null;

// Toast 容器（延迟初始化）
let toastContainer = null;

// 定时器 ID（用于清理）
let syncInterval = null;

/**
 * 创建 Toast 容器
 */
function createToastContainer() {
	if (toastContainer) return toastContainer;

	const container = document.createElement('div');
	container.id = 'canglang-toast-container';
	container.style.cssText = `
		position: fixed;
		top: 20px;
		right: 20px;
		z-index: 999999;
		pointer-events: none;
		display: flex;
		flex-direction: column;
		gap: 10px;
	`;
	if (document.body) {
		document.body.appendChild(container);
	} else {
		document.documentElement.appendChild(container);
	}
	toastContainer = container;
	return container;
}

/**
 * 显示 Toast 通知
 * @param {string} message - 通知消息
 * @param {string} type - 通知类型：'success' | 'error' | 'warning' | 'info'
 * @param {number} duration - 显示时长（毫秒），默认 3000
 */
function showToast(message, type = 'info', duration = 3000) {
	try {
		const container = createToastContainer();

		// 创建 Toast 元素
		const toast = document.createElement('div');
		toast.className = `canglang-toast canglang-toast-${type}`;

		// 根据类型选择图标和颜色
		const config = {
			success: { icon: '✓', color: '#10b981', bg: '#d1fae5', border: '#6ee7b7' },
			error: { icon: '✕', color: '#ef4444', bg: '#fee2e2', border: '#fca5a5' },
			warning: { icon: '⚠', color: '#f59e0b', bg: '#fef3c7', border: '#fcd34d' },
			info: { icon: 'ℹ', color: '#3b82f6', bg: '#dbeafe', border: '#93c5fd' }
		};

		const { icon, color, bg } = config[type] || config.info;

		toast.style.cssText = `
			min-width: 220px;
			max-width: 280px;
			padding: 12px 16px;
			background: ${bg};
			border-left: 4px solid ${color};
			border-radius: 8px;
			box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
			display: flex;
			align-items: center;
			gap: 12px;
			font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
			font-size: 14px;
			color: #1f2937;
			pointer-events: auto;
			animation: slideInRight 0.3s ease-out;
			transition: opacity 0.3s ease-out, transform 0.3s ease-out;
		`;

		toast.innerHTML = `
			<div style="
				width: 24px;
				height: 24px;
				border-radius: 50%;
				background: ${color};
				color: white;
				display: flex;
				align-items: center;
				justify-content: center;
				font-weight: bold;
				flex-shrink: 0;
			">${icon}</div>
			<div style="flex: 1; word-break: break-word;">
				<strong style="display: block; margin-bottom: 2px; color: ${color};">沧澜 Token 同步</strong>
				<span class="canglang-toast-message"></span>
			</div>
		`;
		toast.querySelector(".canglang-toast-message").textContent = message;

		// 添加动画样式
		if (!document.getElementById('canglang-toast-animations')) {
			const style = document.createElement('style');
			style.id = 'canglang-toast-animations';
			style.textContent = `
				@keyframes slideInRight {
					from {
						opacity: 0;
						transform: translateX(100%);
					}
					to {
						opacity: 1;
						transform: translateX(0);
					}
				}
			`;
			document.head.appendChild(style);
		}

		// 添加到容器
		container.appendChild(toast);

		// 自动移除
		setTimeout(() => {
			toast.style.opacity = '0';
			toast.style.transform = 'translateX(100%)';
			setTimeout(() => {
				if (toast.parentNode) {
					toast.parentNode.removeChild(toast);
				}
				// 如果容器为空，移除容器
				if (container.children.length === 0) {
					container.remove();
					toastContainer = null;
				}
			}, 300);
		}, duration);

	} catch (error) {
		// Toast 显示失败时，回退到控制台
		console.error('[沧澜插件] Toast 显示失败:', error);
		console.log(`[沧澜插件] ${type.toUpperCase()}: ${message}`);
	}
}

/**
 * 从扩展配置中读取加密密钥并初始化 SecureLS
 */
async function initSecureLS() {
	try {
		// 从扩展配置的默认 profile 中读取加密密钥
		const DEFAULT_KEY = '42e25c85028f15cdc5aa4d483ab7d5bf06af82e9723e03373d28c88834352815';
		let secureKey = DEFAULT_KEY;

		try {
			// 从默认 profile 中读取配置
			const profileKey = 'profile___Default_Settings__';
			const configs = await browser.storage.local.get(profileKey);
			const profile = configs[profileKey];

			if (profile && profile.canglangSecureKey && profile.canglangSecureKey.trim() !== '') {
				secureKey = profile.canglangSecureKey;
				console.log("[沧澜插件] 使用配置的加密密钥");
			} else {
				console.warn("[沧澜插件] 未配置加密密钥，使用默认密钥");
				console.warn("[沧澜插件] 建议在扩展设置中配置 canglangSecureKey");
			}
		} catch (configError) {
			console.warn("[沧澜插件] 读取配置失败，使用默认密钥:", configError);
		}

		// 获取命名空间（从元数据键中提取）
		let namespace = '沧澜';
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (SECURE_META_KEY_PATTERN.test(key)) {
				// 提取命名空间：例如 "沧澜-2.0.3-prod-secure-meta" -> "沧澜-2.0.3-prod"
				namespace = key.replace(/-secure-meta$/, '');
				console.log("[沧澜插件] 找到元数据键:", key);
				break;
			}
		}

		secureLS = new SecureLS({
			encodingType: 'aes',
			encryptionSecret: secureKey,
			isCompression: true,
			metaKey: `${namespace}-secure-meta`
		});

		console.log("[沧澜插件] SecureLS 初始化成功，命名空间:", namespace);
		console.log("[沧澜插件] SecureLS metaKey:", `${namespace}-secure-meta`);
		return true;
	} catch (error) {
		console.error("[沧澜插件] SecureLS 初始化失败:", error);
		showToast('加密系统初始化失败，无法读取加密的 Token 数据', 'error', 5000);
		return false;
	}
}

/**
 * 检查数据是否使用 SecureLS 加密
 * @returns {boolean}
 */
function isDataEncrypted() {
	try {
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (SECURE_META_KEY_PATTERN.test(key)) {
				return true;
			}
		}
		return false;
	} catch (error) {
		console.error("[沧澜插件] 检查加密状态失败:", error);
		return false;
	}
}

/**
 * 查找沧澜平台的 localStorage key
 * @returns {string|null} - 找到的 key，如果没有则返回 null
 */
function findCanglangStorageKey() {
	try {
		// 遍历所有 localStorage keys
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);

			// 检查是否匹配任何已知的模式
			for (const pattern of POSSIBLE_KEY_PATTERNS) {
				if (pattern.test(key)) {
					return key;
				}
			}
		}

		console.log("[沧澜插件] 未找到沧澜平台 Token");
		return null;
	} catch (error) {
		console.error("[沧澜插件] 查找沧澜平台 Token key 失败:", error);
		return null;
	}
}

/**
 * 从 localStorage 读取 Token 并同步到扩展 storage
 * @param {number} retryCount - 当前重试次数
 */
async function syncTokenToExtensionStorage(retryCount = 0) {
	const MAX_RETRIES = 3;
	const RETRY_DELAYS = [1000, 3000, 5000]; // 指数退避延迟（毫秒）

	try {
		// 1. 查找沧澜平台的 localStorage key
		const storageKey = findCanglangStorageKey();

		if (!storageKey) {
			// 没有找到 token，清除扩展 storage 中的旧数据
			await browser.storage.local.remove(STORAGE_KEY);
			console.log("[沧澜插件] 沧澜平台未登录，已清除扩展中的 Token");
			return;
		}

		// 2. 检查数据是否加密
		const encrypted = isDataEncrypted();
		let parsed;

		if (encrypted) {
			// 使用 SecureLS 读取加密数据
			if (!secureLS) {
				console.error("[沧澜插件] SecureLS 未初始化");
				showToast('加密系统未就绪，请刷新页面重试', 'error', 5000);
				return;
			}

			try {
				// SecureLS 会自动处理解密和解压缩，但返回的是字符串
				const decrypted = secureLS.get(storageKey);
				// console.log("[沧澜插件] 成功解密 Token 数据");

				// 如果解密后是字符串，需要再次 JSON 解析
				if (typeof decrypted === 'string') {
					parsed = JSON.parse(decrypted);
					// console.log("[沧澜插件] 已将解密字符串转换为对象");
				} else {
					parsed = decrypted;
				}

				// console.log("[沧澜插件] 解析后的数据类型:", typeof parsed);
				// console.log("[沧澜插件] accessToken 存在:", !!parsed?.accessToken);
			} catch (error) {
				console.error("[沧澜插件] SecureLS 解密失败:", error);
				console.error("[沧澜插件] 请检查加密密钥是否正确配置");
				showToast('Token 数据解密失败，请检查加密配置或重新登录', 'error', 5000);
				return;
			}
		} else {
			// 读取明文数据
			const storeData = localStorage.getItem(storageKey);

			if (!storeData) {
				await browser.storage.local.remove(STORAGE_KEY);
				console.log("[沧澜插件] Token 数据为空，已清除扩展中的 Token");
				return;
			}

			// 解析 JSON
			try {
				parsed = JSON.parse(storeData);
			} catch (parseError) {
				console.error("[沧澜插件] Token 数据解析失败:", parseError);
				showToast('Token 数据格式错误，请重新登录', 'error', 5000);
				await browser.storage.local.remove(STORAGE_KEY);
				return;
			}
		}

		// 3. 提取 accessToken
		const accessToken = parsed?.accessToken;

		if (!accessToken || typeof accessToken !== 'string' || accessToken.trim() === '') {
			console.warn("[沧澜插件] Token 无效:", accessToken);
			showToast('检测到无效的 Token，已清除', 'warning', 4000);
			await browser.storage.local.remove(STORAGE_KEY);
			lastSyncedToken = null;
			return;
		}

		// 3.5. 检查 Token 是否过期（JWT Token）
		try {
			const parts = accessToken.split('.');
			if (parts.length === 3) {
				// 解析 JWT payload
				const payload = JSON.parse(atob(parts[1]));

				console.log("[沧澜插件] JWT Payload 解析成功");
				console.log("[沧澜插件] Token 前缀:", accessToken.substring(0, 30) + "...");

				if (payload.exp) {
					const expiresAt = payload.exp * 1000; // JWT exp 是秒，转换为毫秒
					const now = Date.now();

					console.log("[沧澜插件] Token 过期检查:");
					console.log("[沧澜插件]   exp (原始):", payload.exp);
					console.log("[沧澜插件]   expiresAt (毫秒):", expiresAt);
					console.log("[沧澜插件]   过期时间:", new Date(expiresAt).toISOString());
					console.log("[沧澜插件]   now (毫秒):", now);
					console.log("[沧澜插件]   当前时间:", new Date(now).toISOString());
					console.log("[沧澜插件]   时间差 (秒):", Math.floor((expiresAt - now) / 1000));

					if (expiresAt < now) {
						console.warn("[沧澜插件] Token 已过期，不同步到扩展");
						console.warn("[沧澜插件] 过期时间:", new Date(expiresAt).toISOString());
						console.warn("[沧澜插件] 当前时间:", new Date(now).toISOString());
						showToast('检测到过期的 Token，请重新登录沧澜平台', 'warning', 5000);
						// 清除扩展中的过期 Token
						await browser.storage.local.remove(STORAGE_KEY);
						lastSyncedToken = null;
						return;
					}

					// 如果 Token 将在 5 分钟内过期，发出警告但仍然同步
					const timeUntilExpiry = expiresAt - now;
					if (timeUntilExpiry < 5 * 60 * 1000) {
						console.warn("[沧澜插件] Token 即将过期");
						console.warn("[沧澜插件] 剩余有效时间:", Math.floor(timeUntilExpiry / 1000), "秒");
						showToast('Token 即将过期，建议重新登录', 'warning', 4000);
					} else {
						console.log("[沧澜插件] Token 有效，剩余时间:", Math.floor(timeUntilExpiry / 1000), "秒");
					}
				} else {
					console.log("[沧澜插件] Token 没有 exp 字段，跳过过期检查");
				}
			}
		} catch (parseError) {
			// Token 格式错误或不是 JWT，记录警告但继续同步
			console.warn("[沧澜插件] 无法解析 Token 过期时间（可能不是 JWT 格式）:", parseError);
		}

		// 4. 检查 Token 是否真的变化了
		if (lastSyncedToken === accessToken) {
			// Token 没有变化，跳过同步
			return;
		}

		// 5. 保存到扩展 storage
		await browser.storage.local.set({
			[STORAGE_KEY]: {
				token: accessToken,
				updatedAt: new Date().toISOString(),
				source: storageKey,
				encrypted: encrypted
			}
		});

		// 6. 更新缓存
		lastSyncedToken = accessToken;

		console.log("[沧澜插件] 成功同步沧澜平台 Token 到扩展 storage");
		console.log("[沧澜插件] Token 前缀:", accessToken.substring(0, 20) + "...");
		console.log("[沧澜插件] 数据加密:", encrypted ? "是" : "否");

		// 显示成功通知（仅首次同步或重试成功后显示）
		if (retryCount === 0 || retryCount > 0) {
			showToast('Token 同步成功！', 'success', 3000);
		}

	} catch (error) {
		console.error("[沧澜插件] 同步 Token 失败:", error);

		// 如果还有重试机会，进行重试
		if (retryCount < MAX_RETRIES) {
			const delay = RETRY_DELAYS[retryCount];
			console.log(`[沧澜插件] 将在 ${delay}ms 后重试 (${retryCount + 1}/${MAX_RETRIES})`);

			setTimeout(() => {
				syncTokenToExtensionStorage(retryCount + 1);
			}, delay);
		} else {
			// 重试次数用尽，显示错误
			showToast(`同步失败：${error.message || '未知错误'}`, 'error', 5000);
		}
	}
}

/**
 * 监听 localStorage 变化
 */
function watchLocalStorageChanges() {
	// 监听 storage 事件（当 localStorage 发生变化时触发）
	window.addEventListener('storage', (event) => {
		// 检查是否是沧澜平台的 token 变化或元数据变化
		if (event.key && (
			POSSIBLE_KEY_PATTERNS.some(pattern => pattern.test(event.key)) ||
			SECURE_META_KEY_PATTERN.test(event.key)
		)) {
			console.log("[沧澜插件] 检测到沧澜平台 Token 变化，重新同步");
			syncTokenToExtensionStorage();
		}
	});
}

/**
 * 初始化同步
 */
async function init() {
	console.log("[沧澜插件] 沧澜平台 Token 同步脚本已启动");
	console.log("[沧澜插件] 当前页面:", window.location.href);

	// 检查数据是否加密
	const encrypted = isDataEncrypted();
	console.log("[沧澜插件] 数据加密状态:", encrypted ? "已加密" : "明文");

	// 如果数据已加密，初始化 SecureLS
	if (encrypted) {
		const initialized = await initSecureLS();
		if (!initialized) {
			console.error("[沧澜插件] SecureLS 初始化失败，无法解密数据");
			return;
		}
	}

	// 立即执行一次同步
	await syncTokenToExtensionStorage();

	// 监听 localStorage 变化
	watchLocalStorageChanges();

	// 页面可见性变化时重新同步（例如用户切换回此标签页）
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') {
			// 静默同步，只在 Token 真正变化时才会输出日志
			syncTokenToExtensionStorage();
		}
	});

	// 清理旧的定时器（如果存在）
	if (syncInterval) {
		clearInterval(syncInterval);
	}

	// 定期检查 Token 是否变化（每 60 秒检查一次，降低频率）
	syncInterval = setInterval(() => {
		syncTokenToExtensionStorage();
	}, 60000);
}

/**
 * 清理资源
 */
function cleanup() {
	// 清理定时器
	if (syncInterval) {
		clearInterval(syncInterval);
		syncInterval = null;
		console.log("[沧澜插件] 已清理定时器");
	}
}

// 页面卸载时清理资源
window.addEventListener('beforeunload', cleanup);
window.addEventListener('unload', cleanup);

// 页面加载完成后初始化
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init);
} else {
	init();
}
