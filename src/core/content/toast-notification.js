/*
 * 通用 Toast 通知系统
 *
 * 此脚本在所有页面上运行，用于显示来自 background script 的 Toast 通知
 * 主要用于向用户反馈保存操作的成功或失败状态
 */

/* global browser */

// Toast 容器（延迟初始化）
let toastContainer = null;

/**
 * 创建 Toast 容器
 */
function createToastContainer() {
	if (toastContainer) return toastContainer;

	const container = document.createElement('div');
	container.id = 'singlefile-toast-container';
	container.style.cssText = `
		position: fixed;
		top: 20px;
		right: 20px;
		z-index: 2147483647;
		pointer-events: none;
		display: flex;
		flex-direction: column;
		gap: 10px;
	`;
	document.body.appendChild(container);
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
		// 确保 body 已加载
		if (!document.body) {
			console.warn('[SingleFile Toast] document.body 未加载，无法显示 Toast');
			return;
		}

		const container = createToastContainer();

		// 创建 Toast 元素
		const toast = document.createElement('div');
		toast.className = `singlefile-toast singlefile-toast-${type}`;

		// 根据类型选择图标和颜色
		const config = {
			success: { icon: '✓', color: '#10b981', bg: '#d1fae5', border: '#6ee7b7' },
			error: { icon: '✕', color: '#ef4444', bg: '#fee2e2', border: '#fca5a5' },
			warning: { icon: '⚠', color: '#f59e0b', bg: '#fef3c7', border: '#fcd34d' },
			info: { icon: 'ℹ', color: '#3b82f6', bg: '#dbeafe', border: '#93c5fd' }
		};

		const { icon, color, bg } = config[type] || config.info;

		toast.style.cssText = `
			min-width: 300px;
			max-width: 400px;
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
				<strong style="display: block; margin-bottom: 2px; color: ${color};">沧澜插件</strong>
				${message}
			</div>
		`;

		// 添加动画样式
		if (!document.getElementById('singlefile-toast-animations')) {
			const style = document.createElement('style');
			style.id = 'singlefile-toast-animations';
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
				if (container.children.length === 0 && container.parentNode) {
					container.parentNode.removeChild(container);
					toastContainer = null;
				}
			}, 300);
		}, duration);

	} catch (error) {
		// Toast 显示失败时，回退到控制台
		console.error('[SingleFile Toast] 显示失败:', error);
		console.log(`[SingleFile Toast] ${type.toUpperCase()}: ${message}`);
	}
}

/**
 * 监听来自 background script 的消息
 */
browser.runtime.onMessage.addListener((message, sender) => {
	if (message.method === 'content.showToast') {
		const { message: toastMessage, type, duration } = message;
		showToast(toastMessage, type, duration);
		return Promise.resolve({ success: true });
	}
});

console.log('[SingleFile Toast] Toast 通知系统已加载');
