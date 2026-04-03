/*
 * Copyright 2010-2020 Gildas Lormeau
 * contact : gildas.lormeau <at> gmail.com
 *
 * This file is part of SingleFile.
 *
 *   The code in this file is free software: you can redistribute it and/or
 *   modify it under the terms of the GNU Affero General Public License
 *   (GNU AGPL) as published by the Free Software Foundation, either version 3
 *   of the License, or (at your option) any later version.
 *
 *   The code in this file is distributed in the hope that it will be useful,
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Affero
 *   General Public License for more details.
 *
 *   As additional permission under GNU AGPL version 3 section 7, you may
 *   distribute UNMODIFIED VERSIONS OF THIS file without the copy of the GNU
 *   AGPL normally required by section 4, provided you include this license
 *   notice and a URL through which recipients can access the Corresponding
 *   Source.
 */

/* global browser, fetch, Blob, TextEncoder */

import * as config from "./config.js";
import * as bookmarks from "./bookmarks.js";
import * as companion from "./companion.js";
import * as business from "./business.js";
import * as editor from "./editor.js";
import { launchWebAuthFlow, extractAuthCode } from "./tabs-util.js";
import * as ui from "./../../ui/bg/index.js";
import * as woleet from "./../../lib/woleet/woleet.js";
import { GDrive } from "./../../lib/gdrive/gdrive.js";
import { Dropbox } from "./../../lib/dropbox/dropbox.js";
import { WebDAV } from "./../../lib/webdav/webdav.js";
import { GitHub } from "./../../lib/github/github.js";
import { S3 } from "./../../lib/s3/s3.js";
import { MCP } from "./../../lib/mcp/mcp.js";
import { download } from "./download-util.js";
import * as yabson from "./../../lib/yabson/yabson.js";
import { RestFormApi } from "../../lib/../lib/rest-form-api/index.js";
import * as offscreen from "./offscreen.js";

const partialContents = new Map();
const tabData = new Map();
const SCOPES = ["https://www.googleapis.com/auth/drive.file"];
const CONFLICT_ACTION_SKIP = "skip";
const CONFLICT_ACTION_UNIQUIFY = "uniquify";
const REGEXP_ESCAPE = /([{}()^$&.*?/+|[\\\\]|\]|-)/g;
let GDRIVE_CLIENT_ID = "207618107333-h1220p1oasj3050kr5r416661adm091a.apps.googleusercontent.com";
let GDRIVE_CLIENT_KEY = "VQJ8Gq8Vxx72QyxPyeLtWvUt";
const DROPBOX_CLIENT_ID = "s50p6litdvuzrtb";
const DROPBOX_CLIENT_KEY = "i1vzwllesr14fzd";

const gDriveOauth2 = browser.runtime.getManifest().oauth2;
if (gDriveOauth2) {
	GDRIVE_CLIENT_ID = gDriveOauth2.client_id;
	GDRIVE_CLIENT_KEY = gDriveOauth2.client_secret;
}
const gDrive = new GDrive(GDRIVE_CLIENT_ID, GDRIVE_CLIENT_KEY, SCOPES);
const dropbox = new Dropbox(DROPBOX_CLIENT_ID, DROPBOX_CLIENT_KEY);

export {
	onMessage,
	downloadPage,
	testSkipSave,
	saveToGDrive,
	saveToGitHub,
	saveToDropbox,
	saveWithWebDAV,
	saveToRestFormApi,
	saveToS3,
	saveWithMCP,
	saveToCanglang,
	encodeSharpCharacter
};

async function onMessage(message, sender) {
	if (message.method.endsWith(".download")) {
		return downloadTabPage(message, sender.tab);
	}
	if (message.method.endsWith(".disableGDrive")) {
		const authInfo = await config.getAuthInfo();
		config.removeAuthInfo();
		await gDrive.revokeAuthToken(authInfo && (authInfo.accessToken || authInfo.revokableAccessToken));
		return {};
	}
	if (message.method.endsWith(".disableDropbox")) {
		const authInfo = await config.getDropboxAuthInfo();
		config.removeDropboxAuthInfo();
		await dropbox.revokeAuthToken(authInfo && (authInfo.accessToken || authInfo.revokableAccessToken));
		return {};
	}
	if (message.method.endsWith(".end")) {
		if (message.hash) {
			try {
				await woleet.anchor(message.hash, message.woleetKey);
			} catch (error) {
				ui.onError(sender.tab.id, error.message, error.link);
			}
		}
		business.onSaveEnd(message.taskId);
		return {};
	}
	if (message.method.endsWith(".getInfo")) {
		return business.getTasksInfo();
	}
	if (message.method.endsWith(".cancel")) {
		if (message.taskId) {
			business.cancelTask(message.taskId);
		} else {
			business.cancel(sender.tab.id);
		}
		return {};
	}
	if (message.method.endsWith(".cancelAll")) {
		business.cancelAllTasks();
		return {};
	}
	if (message.method.endsWith(".saveUrls")) {
		business.saveUrls(message.urls);
		return {};
	}
}

async function downloadTabPage(message, tab) {
	const tabId = tab.id;
	let contents;
	if (message.blobURL) {
		try {
			message.url = message.blobURL;
			if (message.compressContent) {
				message.pageData = await yabson.parse(new Uint8Array(await (await fetch(message.blobURL)).arrayBuffer()));
				await downloadCompressedContent(message, tab);
			} else {
				message.content = await (await fetch(message.blobURL)).text();
				await downloadContent(message, tab);
			}
			// eslint-disable-next-line no-unused-vars
		} catch (error) {
			return { error: true };
		} finally {
			try {
				await offscreen.revokeObjectURL(message.blobURL);
				// eslint-disable-next-line no-unused-vars
			} catch (error) {
				// ignored
			}
		}
	} else if (message.compressContent) {
		let parser = tabData.get(tabId);
		if (!parser) {
			parser = yabson.getParser();
			tabData.set(tabId, parser);
		}
		if (message.data) {
			await parser.next(new Uint8Array(message.data));
		} else {
			tabData.delete(tabId);
			const result = await parser.next();
			const message = result.value;
			await downloadCompressedContent(message, tab);
		}
	} else {
		if (message.truncated) {
			contents = partialContents.get(tabId);
			if (!contents) {
				contents = [];
				partialContents.set(tabId, contents);
			}
			contents.push(message.content);
			if (message.finished) {
				partialContents.delete(tabId);
			}
		} else if (message.content) {
			contents = [message.content];
		}
		if (!message.truncated || message.finished) {
			message.content = contents.join("");
			try {
				message.url = await offscreen.getBlobURL(Array.from(new TextEncoder().encode(message.content)), message.mimeType);
				await downloadContent(message, tab);
			} finally {
				try {
					await offscreen.revokeObjectURL(message.url);
					// eslint-disable-next-line no-unused-vars
				} catch (error) {
					// ignored
				}
			}
		}
	}
	return {};
}

async function downloadContent(message, tab) {
	const tabId = tab.id;
	try {
		// 如果启用了沧澜平台保存，提前检查 Token
		let canglangToken = null;
		if (message.saveToCanglang) {
			canglangToken = await getCanglangTokenFromStorage();
			if (!canglangToken) {
				await sendToastNotification(tabId, '未登录沧澜平台，请先登录后再试', 'error', 5000);
				throw new Error(`未登录沧澜平台，请登录后重试`);
			}
		}

		let skipped;
		// 检查是否跳过保存（仅针对本地下载，不包括云端保存）
		if (message.backgroundSave && !message.saveToGDrive && !message.saveToDropbox && !message.saveWithWebDAV && !message.saveToGitHub && !message.saveToRestFormApi && !message.saveToS3 && !message.saveToCanglang) {
			const testSkip = await testSkipSave(message.filename, message);
			message.filenameConflictAction = testSkip.filenameConflictAction;
			skipped = testSkip.skipped;
		}
		if (skipped) {
			ui.onEnd(tabId);
		} else {
			const prompt = filename => promptFilename(tabId, filename);
			let response;
			if (message.openEditor) {
				ui.onEdit(tabId);
				await editor.open({ tabIndex: tab.index + 1, filename: message.filename, content: message.content, url: message.originalUrl });
			} else if (message.saveToClipboard) {
				await offscreen.saveToClipboard(message.content, message.mimeType);
			} else if (message.saveToCanglang) {
				// 保存到沧澜平台
				// Token 已在函数开头检查并获取
				response = await saveToCanglang(
					message.taskId,
					message.content,           // HTML 内容
					message.originalUrl,         // 原始网页URL
					message.title,               // 页面标题
					message.canglangApiUrl,      // 沧澜平台 API 地址
					canglangToken                // JWT Token（已提前获取）
				);
				// 显示成功消息给用户
				ui.onEnd(tabId);
				// 发送 Toast 成功通知
				await sendToastNotification(tabId, '已成功保存至沧澜平台！', 'success', 4000);
			} else if (message.saveWithWebDAV) {
				response = await saveWithWebDAV(message.taskId, encodeSharpCharacter(message.filename), message.content, message.webDAVURL, message.webDAVUser, message.webDAVPassword, { filenameConflictAction: message.filenameConflictAction, prompt });
			} else if (message.saveWithMCP) {
				response = await saveWithMCP(message.taskId, encodeSharpCharacter(message.filename), message.content, message.mcpServerUrl, message.mcpAuthToken, { filenameConflictAction: message.filenameConflictAction, prompt });
			} else if (message.saveToGDrive) {
				await saveToGDrive(message.taskId, encodeSharpCharacter(message.filename), new Blob([message.content], { type: message.mimeType }), {
					forceWebAuthFlow: message.forceWebAuthFlow
				}, {
					onProgress: (offset, size) => ui.onUploadProgress(tabId, offset, size),
					filenameConflictAction: message.filenameConflictAction,
					prompt
				});
			} else if (message.saveToDropbox) {
				await saveToDropbox(message.taskId, encodeSharpCharacter(message.filename), new Blob([message.content], { type: message.mimeType }), {
					onProgress: (offset, size) => ui.onUploadProgress(tabId, offset, size),
					filenameConflictAction: message.filenameConflictAction,
					prompt
				});
			} else if (message.saveToGitHub) {
				response = await saveToGitHub(message.taskId, encodeSharpCharacter(message.filename), message.content, message.githubToken, message.githubUser, message.githubRepository, message.githubBranch, {
					filenameConflictAction: message.filenameConflictAction,
					prompt
				});
				await response.pushPromise;
			} else if (message.saveWithCompanion) {
				await companion.save({
					filename: message.filename,
					content: message.content,
					title: message.title,
					url: message.originalUrl,
					filenameConflictAction: message.filenameConflictAction
				});
			} else if (message.saveToRestFormApi) {
				response = await saveToRestFormApi(
					message.taskId,
					message.filename,
					message.content,
					tab.url,
					message.saveToRestFormApiToken,
					message.saveToRestFormApiUrl,
					message.saveToRestFormApiFileFieldName,
					message.saveToRestFormApiUrlFieldName
				);
			} else if (message.saveToS3) {
				response = await saveToS3(message.taskId, encodeSharpCharacter(message.filename), new Blob([message.content], { type: message.mimeType }), message.S3Domain, message.S3Region, message.S3Bucket, message.S3AccessKey, message.S3SecretKey, {
					filenameConflictAction: message.filenameConflictAction,
					prompt
				});
			} else {
				response = await downloadPage(message, {
					confirmFilename: message.confirmFilename,
					incognito: tab.incognito,
					filenameConflictAction: message.filenameConflictAction,
					filenameReplacementCharacter: message.filenameReplacementCharacter,
					bookmarkId: message.bookmarkId,
					replaceBookmarkURL: message.replaceBookmarkURL,
					includeInfobar: message.includeInfobar,
					openInfobar: message.openInfobar,
					infobarPositionAbsolute: message.infobarPositionAbsolute,
					infobarPositionTop: message.infobarPositionTop,
					infobarPositionBottom: message.infobarPositionBottom,
					infobarPositionLeft: message.infobarPositionLeft,
					infobarPositionRight: message.infobarPositionRight
				});
				if (!response) {
					throw new Error("upload_cancelled");
				}
			}
			if (message.bookmarkId && message.replaceBookmarkURL && response && response.url) {
				await bookmarks.update(message.bookmarkId, { url: response.url });
			}
			ui.onEnd(tabId);
			if (message.openSavedPage && !message.openEditor) {
				const createTabProperties = { active: true, url: "/src/ui/pages/viewer.html?blobURI=" + message.url };
				if (tab.index != null) {
					createTabProperties.index = tab.index + 1;
				}
				browser.tabs.create(createTabProperties);
			}
		}
	} catch (error) {
		if (!error.message || error.message != "upload_cancelled") {
			console.error(error); // eslint-disable-line no-console

			// 如果是沧澜平台相关的错误，只发送 Toast 通知
			if (message.saveToCanglang) {
				const errorMsg = error.message || '未知错误';
				await sendToastNotification(tabId, `保存失败：${errorMsg}`, 'error', 5000);
			} else {
				// 其他保存方式使用原来的 UI 错误提示
				ui.onError(tabId, error.message, error.link);
			}
		}
	} finally {
		if (!message.openSavedPage && message.url) {
			try {
				await offscreen.revokeObjectURL(message.url);
				// eslint-disable-next-line no-unused-vars
			} catch (error) {
				// ignored
			}
		}
	}
}

async function downloadCompressedContent(message, tab) {
	const tabId = tab.id;
	let blobURI;
	try {
		// 如果启用了沧澜平台保存，提前检查 Token
		let canglangToken = null;
		if (message.saveToCanglang) {
			canglangToken = await getCanglangTokenFromStorage();
			if (!canglangToken) {
				await sendToastNotification(tabId, '未登录沧澜平台，请先登录后再试', 'error', 5000);
				throw new Error(`未登录沧澜平台，请登录后重试`);
			}
		}

		const prompt = filename => promptFilename(tabId, filename);
		let skipped, response;
		// 检查是否跳过保存（仅针对本地下载，不包括云端保存）
		if (message.backgroundSave && !message.saveToGDrive && !message.saveToDropbox && !message.saveWithWebDAV && !message.saveWithMCP && !message.saveToGitHub && !message.saveToRestFormApi && !message.sharePage && !message.saveToCanglang) {
			const testSkip = await testSkipSave(message.filename, message);
			message.filenameConflictAction = testSkip.filenameConflictAction;
			skipped = testSkip.skipped;
		}
		if (skipped) {
			ui.onEnd(tabId);
		} else {
			blobURI = await offscreen.compressPage(message.pageData, {
				insertTextBody: message.insertTextBody,
				url: message.pageData.url || tab.url,
				createRootDirectory: message.createRootDirectory,
				tabId,
				selfExtractingArchive: message.selfExtractingArchive,
				disableCompression: message.disableCompression,
				extractDataFromPage: message.extractDataFromPage,
				preventAppendedData: message.preventAppendedData,
				insertCanonicalLink: message.insertCanonicalLink,
				insertMetaNoIndex: message.insertMetaNoIndex,
				insertMetaCSP: message.insertMetaCSP,
				password: message.password,
				embeddedImage: message.embeddedImage
			});
			if (message.openEditor) {
				ui.onEdit(tabId);
				const content = Array.from(new Uint8Array(await (await fetch(blobURI)).arrayBuffer()));
				await editor.open({
					tabIndex: tab.index + 1,
					filename: message.filename,
					content,
					compressContent: message.compressContent,
					selfExtractingArchive: message.selfExtractingArchive,
					disableCompression: message.disableCompression,
					extractDataFromPage: message.extractDataFromPage,
					insertTextBody: message.insertTextBody,
					insertMetaCSP: message.insertMetaCSP,
					embeddedImage: message.embeddedImage,
					url: message.originalUrl
				});
			} else if (message.foregroundSave || message.sharePage) {
				const blob = (await fetch(blobURI)).blob();
				await downloadPageForeground(message.taskId, message.filename, blob, message.pageData.mimeType, tabId, {
					foregroundSave: message.foregroundSave,
					sharePage: message.sharePage
				});
			} else if (message.saveToCanglang) {
				// 保存压缩内容到沧澜平台
				// Token 已在函数开头检查并获取
				const content = await (await fetch(blobURI)).text();
				response = await saveToCanglang(
					message.taskId,
					content,                     // 压缩后的内容
					message.originalUrl,         // 原始网页URL
					message.title,               // 页面标题
					message.canglangApiUrl,      // 沧澜平台 API 地址
					canglangToken                // JWT Token（已提前获取）
				);
				// 显示成功消息给用户
				ui.onEnd(tabId);
				// 发送 Toast 成功通知
				await sendToastNotification(tabId, '已成功保存至沧澜平台！', 'success', 4000);
			} else if (message.saveWithWebDAV) {
				const blob = await (await fetch(blobURI)).blob();
				response = await saveWithWebDAV(message.taskId, encodeSharpCharacter(message.filename), blob, message.webDAVURL, message.webDAVUser, message.webDAVPassword, { filenameConflictAction: message.filenameConflictAction, prompt });
			} else if (message.saveWithMCP) {
				const blob = await (await fetch(blobURI)).blob();
				response = await saveWithMCP(message.taskId, encodeSharpCharacter(message.filename), blob, message.mcpServerUrl, message.mcpAuthToken, { filenameConflictAction: message.filenameConflictAction, prompt });
			} else if (message.saveToGDrive) {
				const blob = await (await fetch(blobURI)).blob();
				await saveToGDrive(message.taskId, encodeSharpCharacter(message.filename), blob, {
					forceWebAuthFlow: message.forceWebAuthFlow
				}, {
					onProgress: (offset, size) => ui.onUploadProgress(tabId, offset, size),
					filenameConflictAction: message.filenameConflictAction,
					prompt
				});
			} else if (message.saveToDropbox) {
				const blob = await (await fetch(blobURI)).blob();
				await saveToDropbox(message.taskId, encodeSharpCharacter(message.filename), blob, {
					onProgress: (offset, size) => ui.onUploadProgress(tabId, offset, size),
					filenameConflictAction: message.filenameConflictAction,
					prompt
				});
			} else if (message.saveToGitHub) {
				const blob = await (await fetch(blobURI)).blob();
				response = await saveToGitHub(message.taskId, encodeSharpCharacter(message.filename), blob, message.githubToken, message.githubUser, message.githubRepository, message.githubBranch, {
					filenameConflictAction: message.filenameConflictAction,
					prompt
				});
				await response.pushPromise;
			} else if (message.saveToRestFormApi) {
				const blob = await (await fetch(blobURI)).blob();
				response = await saveToRestFormApi(
					message.taskId,
					message.filename,
					blob,
					tab.url,
					message.saveToRestFormApiToken,
					message.saveToRestFormApiUrl,
					message.saveToRestFormApiFileFieldName,
					message.saveToRestFormApiUrlFieldName
				);
			} else if (message.saveToS3) {
				const blob = await (await fetch(blobURI)).blob();
				response = await saveToS3(message.taskId, encodeSharpCharacter(message.filename), blob, message.S3Domain, message.S3Region, message.S3Bucket, message.S3AccessKey, message.S3SecretKey, {
					filenameConflictAction: message.filenameConflictAction,
					prompt
				});
			} else {
				if (message.backgroundSave) {
					message.url = blobURI;
					response = await downloadPage(message, {
						confirmFilename: message.confirmFilename,
						incognito: tab.incognito,
						filenameConflictAction: message.filenameConflictAction,
						filenameReplacementCharacter: message.filenameReplacementCharacter,
						bookmarkId: message.bookmarkId,
						replaceBookmarkURL: message.replaceBookmarkURL,
						includeInfobar: message.includeInfobar,
						openInfobar: message.openInfobar,
						infobarPositionAbsolute: message.infobarPositionAbsolute,
						infobarPositionTop: message.infobarPositionTop,
						infobarPositionBottom: message.infobarPositionBottom,
						infobarPositionLeft: message.infobarPositionLeft,
						infobarPositionRight: message.infobarPositionRight
					});
				} else {
					const blob = await (await fetch(blobURI)).blob();
					await downloadPageForeground(message.taskId, message.filename, blob, message.mimeType, tabId);
				}
			}
			if (message.bookmarkId && message.replaceBookmarkURL && response && response.url) {
				await bookmarks.update(message.bookmarkId, { url: response.url });
			}
			ui.onEnd(tabId);
			if (message.openSavedPage && !message.openEditor) {
				const createTabProperties = { active: true, url: "/src/ui/pages/viewer.html?compressed&blobURI=" + blobURI, windowId: tab.windowId };
				if (tab.index != null) {
					createTabProperties.index = tab.index + 1;
				}
				browser.tabs.create(createTabProperties);
			}
		}
	} catch (error) {
		if (!error.message || error.message != "upload_cancelled") {
			console.error(error); // eslint-disable-line no-console

			// 如果是沧澜平台相关的错误，只发送 Toast 通知
			if (message.saveToCanglang) {
				const errorMsg = error.message || '未知错误';
				await sendToastNotification(tabId, `保存失败：${errorMsg}`, 'error', 5000);
			} else {
				// 其他保存方式使用原来的 UI 错误提示
				ui.onError(tabId, error.message, error.link);
			}
		}
	} finally {
		if (!message.openSavedPage && blobURI) {
			try {
				await offscreen.revokeObjectURL(blobURI);
				// eslint-disable-next-line no-unused-vars
			} catch (error) {
				// ignored
			}
		}
	}
}

function encodeSharpCharacter(path) {
	return path.replace(/#/g, "%23");
}

function getRegExp(string) {
	return string.replace(REGEXP_ESCAPE, "\\$1");
}

async function getAuthInfo(authOptions, force) {
	let authInfo = await config.getAuthInfo();
	const options = {
		interactive: true,
		forceWebAuthFlow: authOptions.forceWebAuthFlow,
		launchWebAuthFlow: options => launchWebAuthFlow(options),
		extractAuthCode: authURL => extractAuthCode(authURL)
	};
	gDrive.setAuthInfo(authInfo, options);
	if (!authInfo || !authInfo.accessToken || force) {
		authInfo = await gDrive.auth(options);
		if (authInfo) {
			await config.setAuthInfo(authInfo);
		} else {
			await config.removeAuthInfo();
		}
	}
	return authInfo;
}

async function getDropboxAuthInfo(force) {
	let authInfo = await config.getDropboxAuthInfo();
	const options = {
		launchWebAuthFlow: options => launchWebAuthFlow(options),
		extractAuthCode: authURL => extractAuthCode(authURL)
	};
	dropbox.setAuthInfo(authInfo);
	if (!authInfo || !authInfo.accessToken || force) {
		authInfo = await dropbox.auth(options);
		if (authInfo) {
			await config.setDropboxAuthInfo(authInfo);
		} else {
			await config.removeDropboxAuthInfo();
		}
	}
	return authInfo;
}

async function saveToGitHub(taskId, filename, content, githubToken, githubUser, githubRepository, githubBranch, { filenameConflictAction, prompt }) {
	try {
		const taskInfo = business.getTaskInfo(taskId);
		if (!taskInfo || !taskInfo.cancelled) {
			const client = new GitHub(githubToken, githubUser, githubRepository, githubBranch);
			business.setCancelCallback(taskId, () => client.abort());
			return await client.upload(filename, content, { filenameConflictAction, prompt });
		}
	} catch (error) {
		throw new Error(error.message + " (GitHub)");
	}
}

async function saveToS3(taskId, filename, blob, domain, region, bucket, accessKey, secretKey, { filenameConflictAction, prompt }) {
	try {
		const taskInfo = business.getTaskInfo(taskId);
		if (!taskInfo || !taskInfo.cancelled) {
			const client = new S3(region, bucket, accessKey, secretKey, domain);
			business.setCancelCallback(taskId, () => client.abort());
			return await client.upload(filename, blob, { filenameConflictAction, prompt });
		}
	} catch (error) {
		throw new Error(error.message + " (S3)");
	}
}

async function saveWithWebDAV(taskId, filename, content, url, username, password, { filenameConflictAction, prompt }) {
	try {
		const taskInfo = business.getTaskInfo(taskId);
		if (!taskInfo || !taskInfo.cancelled) {
			const client = new WebDAV(url, username, password);
			business.setCancelCallback(taskId, () => client.abort());
			return await client.upload(filename, content, { filenameConflictAction, prompt });
		}
	} catch (error) {
		throw new Error(error.message + " (WebDAV)");
	}
}

async function saveWithMCP(taskId, filename, content, serverUrl, authToken, { filenameConflictAction, prompt }) {
	try {
		const taskInfo = business.getTaskInfo(taskId);
		if (!taskInfo || !taskInfo.cancelled) {
			const client = new MCP(serverUrl, authToken);
			business.setCancelCallback(taskId, () => client.abort());
			return await client.upload(filename, content, { filenameConflictAction, prompt });
		}
	} catch (error) {
		throw new Error(error.message + " (MCP)");
	}
}

async function saveToGDrive(taskId, filename, blob, authOptions, uploadOptions) {
	try {
		await getAuthInfo(authOptions);
		const taskInfo = business.getTaskInfo(taskId);
		if (!taskInfo || !taskInfo.cancelled) {
			return await gDrive.upload(filename, blob, uploadOptions, callback => business.setCancelCallback(taskId, callback));
		}
	}
	catch (error) {
		if (error.message == "invalid_token") {
			let authInfo;
			try {
				authInfo = await gDrive.refreshAuthToken();
			} catch (error) {
				if (error.message == "unknown_token") {
					authInfo = await getAuthInfo(authOptions, true);
				} else {
					throw new Error(error.message + " (Google Drive)");
				}
			}
			if (authInfo) {
				await config.setAuthInfo(authInfo);
			} else {
				await config.removeAuthInfo();
			}
			return await saveToGDrive(taskId, filename, blob, authOptions, uploadOptions);
		} else {
			throw new Error(error.message + " (Google Drive)");
		}
	}
}

async function saveToDropbox(taskId, filename, blob, uploadOptions) {
	try {
		await getDropboxAuthInfo();
		const taskInfo = business.getTaskInfo(taskId);
		if (!taskInfo || !taskInfo.cancelled) {
			return await dropbox.upload(filename, blob, uploadOptions, callback => business.setCancelCallback(taskId, callback));
		}
	}
	catch (error) {
		if (error.message == "invalid_token") {
			let authInfo;
			try {
				authInfo = await dropbox.refreshAuthToken();
			} catch (error) {
				if (error.message == "unknown_token") {
					authInfo = await getDropboxAuthInfo(true);
				} else {
					throw new Error(error.message + " (Dropbox)");
				}
			}
			if (authInfo) {
				await config.setDropboxAuthInfo(authInfo);
			} else {
				await config.removeDropboxAuthInfo();
			}
			return await saveToDropbox(taskId, filename, blob, uploadOptions);
		} else {
			throw new Error(error.message + " (Dropbox)");
		}
	}
}

async function testSkipSave(filename, options) {
	let skipped, filenameConflictAction = options.filenameConflictAction;
	if (filenameConflictAction == CONFLICT_ACTION_SKIP) {
		const downloadItems = await browser.downloads.search({
			filenameRegex: "(\\\\|/)" + getRegExp(filename) + "$",
			exists: true
		});
		if (downloadItems.length) {
			skipped = true;
		} else {
			filenameConflictAction = CONFLICT_ACTION_UNIQUIFY;
		}
	}
	return { skipped, filenameConflictAction };
}

function promptFilename(tabId, filename) {
	return browser.tabs.sendMessage(tabId, { method: "content.prompt", message: "Filename conflict, please enter a new filename", value: filename });
}

async function downloadPage(pageData, options) {
	const downloadInfo = {
		url: pageData.url,
		saveAs: options.confirmFilename,
		filename: pageData.filename,
		conflictAction: options.filenameConflictAction
	};
	if (options.incognito) {
		downloadInfo.incognito = true;
	}
	const downloadData = await download(downloadInfo, options.filenameReplacementCharacter);
	if (downloadData.filename) {
		let url = downloadData.filename;
		if (!url.startsWith("file:")) {
			if (url.startsWith("/")) {
				url = url.substring(1);
			}
			url = "file:///" + encodeSharpCharacter(url);
		}
		return { url };
	}
}

async function saveToRestFormApi(taskId, filename, content, url, token, restApiUrl, fileFieldName, urlFieldName) {
	try {
		const taskInfo = business.getTaskInfo(taskId);
		if (!taskInfo || !taskInfo.cancelled) {
			const client = new RestFormApi(token, restApiUrl, fileFieldName, urlFieldName);
			business.setCancelCallback(taskId, () => client.abort());
			return await client.upload(filename, content, url);
		}
	} catch (error) {
		throw new Error(error.message + " (RestFormApi)");
	}
}

async function downloadPageForeground(taskId, filename, content, mimeType, tabId, { foregroundSave, sharePage } = {}) {
	const serializer = yabson.getSerializer({
		filename,
		taskId,
		foregroundSave,
		sharePage,
		content: await content.arrayBuffer(),
		mimeType
	});
	for await (const data of serializer) {
		await browser.tabs.sendMessage(tabId, {
			method: "content.download",
			data: Array.from(data)
		});
	}
	return browser.tabs.sendMessage(tabId, { method: "content.download" });
}

// ===== 沧澜平台集成功能 =====

/**
 * 从扩展 storage 中读取沧澜平台的认证 Token
 * Token 由沧澜平台页面的同步脚本自动更新
 *
 * @returns {Promise<string|null>} - 返回 Token，如果未找到或已过期则返回 null
 */
async function getCanglangTokenFromStorage() {
	try {
		console.log("[沧澜插件] 尝试从 storage 读取沧澜平台 Token...");
		const result = await browser.storage.local.get("canglangAuthToken");
		console.log("[沧澜插件] Storage 返回结果:", result);
		const tokenData = result.canglangAuthToken;

		if (!tokenData || !tokenData.token) {
			console.log("[沧澜插件] 沧澜平台 Token 未找到，请先登录沧澜平台");
			console.log("[沧澜插件] tokenData:", tokenData);
			return null;
		}

		// 检查 Token 是否过期（JWT Token）
		try {
			// JWT Token 格式: header.payload.signature
			const parts = tokenData.token.split('.');
			if (parts.length === 3) {
				// 解析 payload（Base64 编码）
				const payload = JSON.parse(atob(parts[1]));

				if (payload.exp) {
					const expiresAt = payload.exp * 1000; // JWT exp 是秒，转换为毫秒
					const now = Date.now();

					if (expiresAt < now) {
						console.warn("[沧澜插件] Token 已过期");
						console.warn("[沧澜插件] 过期时间:", new Date(expiresAt).toISOString());
						console.warn("[沧澜插件] 当前时间:", new Date(now).toISOString());
						// 清除过期的 Token
						await browser.storage.local.remove("canglangAuthToken");
						return null;
					}

					// 如果 Token 将在 5 分钟内过期，发出警告
					const timeUntilExpiry = expiresAt - now;
					if (timeUntilExpiry < 5 * 60 * 1000) {
						console.warn("[沧澜插件] Token 即将过期，建议重新登录");
						console.warn("[沧澜插件] 剩余有效时间:", Math.floor(timeUntilExpiry / 1000), "秒");
					}
				}
			}
		} catch (parseError) {
			// Token 格式错误或不是 JWT，继续使用但记录警告
			console.warn("[沧澜插件] 无法解析 Token 过期时间（可能不是 JWT 格式）:", parseError);
		}

		console.log("[沧澜插件] 成功从扩展 storage 读取沧澜平台 Token");
		console.log("[沧澜插件] Token 更新时间:", tokenData.updatedAt);
		console.log("[沧澜插件] Token 来源:", tokenData.source);
		return tokenData.token;
	} catch (error) {
		console.error("[沧澜插件] 读取沧澜平台 Token 失败:", error);
		return null;
	}
}

/**
 * 从 HTML 内容中提取 meta description
 * 使用正则表达式快速提取，无需解析整个 DOM
 *
 * @param {string} htmlContent - HTML 内容
 * @returns {string} - 描述文本，如果未找到则返回空字符串
 */
function extractDescription(htmlContent) {
	try {
		// 优先提取 og:description
		let match = htmlContent.match(/<meta\s+property=["']og:description["']\s+content=["']([^"']+)["']/i);
		if (match && match[1]) {
			return match[1].trim();
		}

		// 尝试提取标准 meta description
		match = htmlContent.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i);
		if (match && match[1]) {
			return match[1].trim();
		}

		// 如果都没有，返回空字符串
		return '';
	} catch (error) {
		console.error("提取 description 失败:", error);
		return '';
	}
}

/**
 * 保存网页到沧澜平台
 *
 * 此函数将处理后的网页数据发送到沧澜平台的归档 API。
 * Token 会自动从扩展 storage 中读取（由沧澜平台页面的同步脚本自动更新）。
 *
 * @param {number} taskId - 任务ID，用于跟踪和取消操作
 * @param {string} content - HTML 内容字符串
 * @param {string} pageUrl - 原始网页URL
 * @param {string} pageTitle - 网页标题
 * @param {string} apiUrl - 沧澜平台 API 地址
 * @param {string} authToken - JWT 认证 Token
 *
 * @returns {Promise<Object>} - API 响应对象
 *
 * @throws {Error} - 如果请求失败则抛出错误
 *
 * @example
 * const response = await saveToCanglang(
 *   taskId,
 *   "<html>...</html>",
 *   "https://example.com",
 *   "Example Page",
 *   "https://canglang.example.com/api/v1/archives",
 *   "jwt_token_here"
 * );
 */
async function saveToCanglang(taskId, content, pageUrl, pageTitle, apiUrl, authToken) {
	try {
		// 检查任务是否已被取消
		const taskInfo = business.getTaskInfo(taskId);
		if (!taskInfo || !taskInfo.cancelled) {
			// 设置取消回调（用于中止请求）
			let abortController = new AbortController();
			business.setCancelCallback(taskId, () => abortController.abort());

			console.log("[沧澜插件] saveToCanglang 参数检查:");
			console.log("[沧澜插件]   apiUrl:", apiUrl);
			console.log("[沧澜插件]   pageUrl:", pageUrl);
			console.log("[沧澜插件]   pageTitle:", pageTitle);
			console.log("[沧澜插件]   authToken:", authToken ? "已获取 (" + authToken.substring(0, 20) + "...)" : "未获取");
			console.log("[沧澜插件]   content长度:", content ? content.length : "undefined");

			if (!apiUrl) {
				throw new Error("沧澜平台 API 地址未配置，请在设置中配置 canglangApiUrl");
			}

			// 从 HTML 内容中提取页面描述
			const extractedDescription = extractDescription(content);
			const description = extractedDescription || pageTitle;

			// 构建请求数据，符合沧澜平台 API 规范
			const requestData = {
				url: pageUrl,                     // 网页URL（必填）
				page_title: pageTitle,            // 网页标题（必填）
				description: description,         // 网页描述（从 meta 标签提取或使用默认值）
				html_content: content,            // HTML内容（必填）
			};

			// 构建请求头
			const headers = {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${authToken}`  // 使用传入的认证 Token
			};

			// 发送 POST 请求到沧澜平台 API
			const response = await fetch(apiUrl, {
				method: "POST",
				headers: headers,
				body: JSON.stringify(requestData),
				signal: abortController.signal  // 支持取消请求
			});

			// 检查响应状态
			if (!response.ok) {
				// 尝试解析错误消息
				let errorMessage;
				try {
					const errorData = await response.json();
					errorMessage = errorData.message || errorData.detail || response.statusText;
				} catch (e) {
					errorMessage = response.statusText;
				}

				// 根据状态码提供更友好的错误信息
				if (response.status === 401) {
					throw new Error(`认证失败，请重新登录沧澜平台`);
				} else if (response.status === 403) {
					throw new Error(`权限不足，无法保存到沧澜平台`);
				} else if (response.status === 413) {
					throw new Error(`内容过大，超过沧澜平台限制`);
				} else if (response.status === 422) {
					throw new Error(`数据格式错误: ${errorMessage}`);
				} else if (response.status >= 500) {
					throw new Error(`沧澜平台服务器错误 (${response.status})`);
				} else {
					throw new Error(`保存失败 (${response.status}): ${errorMessage}`);
				}
			}

			// 解析成功响应
			const result = await response.json();

			// 返回结果对象（包含成功标志）
			return {
				success: true,
				data: result,
				url: pageUrl
			};
		}
	} catch (error) {
		// 统一错误处理
		if (error.name === "AbortError") {
			throw new Error("请求已取消");
		} else if (error.name === "TypeError" && error.message.includes("fetch")) {
			throw new Error("网络连接失败，请检查沧澜平台是否可访问");
		}
		// 保留原始错误信息，不再添加 "(沧澜平台)" 后缀
		throw error;
	}
}

/**
 * 向指定标签页发送 Toast 通知
 * @param {number} tabId - 标签页 ID
 * @param {string} message - 通知消息
 * @param {string} type - 通知类型：'success' | 'error' | 'warning' | 'info'
 * @param {number} duration - 显示时长（毫秒），默认 3000
 */
async function sendToastNotification(tabId, message, type = 'info', duration = 3000) {
	try {
		await browser.tabs.sendMessage(tabId, {
			method: 'content.showToast',
			message,
			type,
			duration
		});
		console.log('[沧澜插件] Toast 通知发送成功');
	} catch (error) {
		// sendMessage 失败时（content script 未注入），动态注入后重试
		console.log('[沧澜插件] Toast script 未加载，尝试动态注入...');
		try {
			await browser.scripting.executeScript({
				target: { tabId },
				files: ['lib/toast-notification.js']
			});
			await browser.tabs.sendMessage(tabId, {
				method: 'content.showToast',
				message,
				type,
				duration
			});
			console.log('[沧澜插件] Toast 通知发送成功（动态注入）');
		} catch (e) {
			console.log('[沧澜插件] Toast 通知发送失败:', e.message);
		}
	}
}
