// ============================================================================
// 文件名：background.js
// 作用：插件的后台常驻服务脚本（Service Worker），负责定时闹钟、随机时间调度和原生网页点击签到
// ============================================================================

importScripts("checkin-gate.js");
const CheckinGate = globalThis.CheckinGate;

// 【辅助工具 1】延时等待函数（模拟人类停顿思考）
// 参数 ms：需要等待的毫秒数（1000 毫秒 = 1 秒）
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// 【辅助工具 2】获取本地时区的今日日期字符串（格式如："2026-11-13"）
function getTodayString() {
  const now = new Date();
  const year = now.getFullYear();
  // getMonth() 返回的是 0~11，所以要 +1；padStart(2, '0') 用于不足两位时在前面补 0
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// 【核心安全配置】确保请求头伪装规则始终生效的函数
// 作用：给插件发出的所有 /api/user/ 请求自动加上官网的 Origin 和 Referer
async function ensureHeaderRules() {
  try {
    const RULES = [{
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [
          { header: 'Origin', operation: 'set', value: 'https://glados.cloud' },
          { header: 'Referer', operation: 'set', value: 'https://glados.cloud/console/checkin' }
        ]
      },
      condition: {
        // 拦截所有 glados.cloud/api/user/ 下的接口（包含设置页拉取日历数据的 points 接口等）
        urlFilter: 'glados.cloud/api/user/',
        resourceTypes: ['xmlhttprequest', 'other']
      }
    }];

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1],
      addRules: RULES
    });
    console.log("[安全伪装] 请求头伪装规则已确认生效。");
  } catch (error) {
    console.error("[安全伪装] 配置伪装规则时发生错误:", error);
  }
}

// ============================================================================
// 生命周期与闹钟监听区域
// ============================================================================

// 1. 当插件安装或更新时触发
chrome.runtime.onInstalled.addListener(async () => {
  console.log("插件已安装或更新，正在初始化配置...");
  await ensureHeaderRules();

  // 创建主巡检闹钟：1 分钟后首次触发，之后每 30 分钟巡检一次
  chrome.alarms.create("checkInAlarm", { delayInMinutes: 1, periodInMinutes: 30 });

  // 安装或更新完成后，立即检查一次是否需要签到
  tryCheckIn();
});

// 2. 监听浏览器启动事件 (Chrome 启动时触发)
chrome.runtime.onStartup.addListener(async () => {
  console.log("检测到浏览器启动，正在恢复伪装规则并检查签到条件...");
  await ensureHeaderRules();
  tryCheckIn();
});

// 3. 监听所有闹钟触发事件
chrome.alarms.onAlarm.addListener(async (alarm) => {
  // 情况 A：常规巡检闹钟响起
  if (alarm.name === "checkInAlarm") {
    console.log("定时巡检闹钟触发，开始检查签到条件...");
    tryCheckIn();
  } 
  // 情况 B：每日随机延迟闹钟响起（真正开始执行自动签到的时刻！）
  else if (alarm.name === "randomDelayAlarm") {
    console.log("⏰ 随机延迟时间已到！准备执行拟人化自动签到...");
    const data = await chrome.storage.local.get(["notifyEnabled", "lastCheckInDate"]);
    const today = getTodayString();

    if (data.lastCheckInDate !== today) {
      // 再额外加入 1 ~ 20 秒的随机秒级停顿，让触发的“秒数”也完全随机
      const randomSecondsMs = Math.floor(Math.random() * 20000) + 1000;
      console.log(`额外等待 ${(randomSecondsMs / 1000).toFixed(1)} 秒以打乱秒级规律...`);
      await sleep(randomSecondsMs);

      // 执行正式自动签到（第三个参数 false 代表自动签到）
      await performFetch(today, data.notifyEnabled, false);
    } else {
      console.log("今日已完成自动签到，取消本次随机闹钟任务。");
    }
  }
});

// ============================================================================
// 自动签到条件判断与随机时间调度
// ============================================================================

async function tryCheckIn() {
  try {
    await ensureHeaderRules();

    const data = await chrome.storage.local.get([
      "notifyEnabled", 
      "lastCheckInDate", 
      "targetHour",
      "scheduledRandomDate"
    ]);

    const now = new Date();
    const today = getTodayString();
    const currentHour = now.getHours();
    const targetHour = data.targetHour !== undefined ? Number(data.targetHour) : 9;

    console.log(`[状态检查] 今日:${today}, 上次签到:${data.lastCheckInDate}, 当前小时:${currentHour}, 目标小时:${targetHour}`);

    // 如果今天已经签过到了，直接结束
    if (data.lastCheckInDate === today) {
      console.log("今日已完成签到，无需重复执行。");
      return;
    }

    // 如果当前时间还没有到设定的目标小时，继续等待
    if (currentHour < targetHour) {
      console.log("尚未到达设定的签到小时，继续等待。");
      return;
    }

    // 区分“准点随机触发”与“晚开电脑补签”
    if (currentHour === targetHour) {
      // 正好处于设定的那个小时内，检查是否已经安排了随机延迟闹钟
      const existingAlarm = await chrome.alarms.get("randomDelayAlarm");
      if (existingAlarm) {
        const triggerTime = new Date(existingAlarm.scheduledTime).toLocaleTimeString();
        console.log(`今日随机签到闹钟已在排队中，将于 ${triggerTime} 触发。`);
        return;
      }

      // 计算当前小时还剩下多少分钟，生成一个随机分钟数（至少 1 分钟，最多不超过剩余分钟数或 45 分钟）
      const remainingMinutes = Math.max(2, 58 - now.getMinutes());
      const maxRandomMinutes = Math.min(45, remainingMinutes);
      // 生成带小数的随机分钟（例如 14.37 分钟，即 14 分 22 秒后触发！）
      const randomDelayMinutes = Number((Math.random() * (maxRandomMinutes - 1) + 1).toFixed(2));

      chrome.alarms.create("randomDelayAlarm", { delayInMinutes: randomDelayMinutes });
      await chrome.storage.local.set({ scheduledRandomDate: today });

      console.log(`🎲 [拟人调度] 已生成今日随机签到计划！将在 ${randomDelayMinutes} 分钟后自动执行。`);
    } else {
      // currentHour > targetHour：说明用户今天开电脑/打开浏览器时，已经错过了设定的那个小时
      // 触发“自动补签机制”：随机等待 5 ~ 20 秒（等浏览器网络稳定）后立刻补签
      console.log("检测到已超过设定小时且今日未签，启动【自动补签】流程...");
      const catchUpWaitMs = Math.floor(Math.random() * 15000) + 5000;
      console.log(`等待 ${(catchUpWaitMs / 1000).toFixed(1)} 秒后立即执行补签...`);
      await sleep(catchUpWaitMs);
      await performFetch(today, data.notifyEnabled, false);
    }

  } catch (error) {
    console.error("执行 tryCheckIn 检查时发生错误:", error);
  }
}

// 读取签到页状态。只看官方验证组件是否已经通过，不把验证令牌带回插件。
function inspectCheckinPage() {
  const path = window.location.pathname || "";
  if (path.includes("login") || path.includes("authenticate")) {
    return { notLoggedIn: true };
  }

  const seen = new Set();
  const tokenFields = [];
  let hasWidgetFrame = false;

  const visit = (root) => {
    if (!root || typeof root.querySelectorAll !== "function" || seen.has(root)) return;
    seen.add(root);

    root.querySelectorAll(
      'textarea[name="cf-turnstile-response"], input[name="cf-turnstile-response"]'
    ).forEach((node) => {
      tokenFields.push(node);
    });

    if (root.querySelector('iframe[src*="challenges.cloudflare.com"], .cf-turnstile, [data-sitekey]')) {
      hasWidgetFrame = true;
    }

    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot) visit(el.shadowRoot);
    });
  };

  visit(document);

  const hasToken = tokenFields.some((node) => typeof node.value === "string" && node.value.length > 0);
  let turnstile = "absent";
  if (hasToken) turnstile = "passed";
  else if (hasWidgetFrame || tokenFields.length > 0) turnstile = "pending";

  const checkinBtn = document.querySelector("button.ckb");
  const label = checkinBtn ? (checkinBtn.innerText || "").replace(/\s+/g, " ").trim() : "";
  const alreadyDone = Boolean(
    checkinBtn && (checkinBtn.classList.contains("is-done") || /已签到|repeats/i.test(label))
  );

  return {
    notLoggedIn: false,
    hasButton: Boolean(checkinBtn),
    alreadyDone,
    buttonDisabled: Boolean(checkinBtn && checkinBtn.disabled),
    turnstile,
    label
  };
}

// 旁听官网自己发出的签到响应，供结果通知使用。不改页面可见性，也不接触验证框。
function installCheckinResponseListener() {
  window.__gladosCheckinResult = null;
  if (window.__gladosHooked) return;
  window.__gladosHooked = true;

  const rawOpen = XMLHttpRequest.prototype.open;
  const rawSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._requestUrl = url;
    return rawOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        if (this._requestUrl && this._requestUrl.includes("/user/checkin") && !this._requestUrl.includes("/challenge")) {
          window.__gladosCheckinResult = JSON.parse(this.responseText);
        }
      } catch (e) {}
    });
    return rawSend.apply(this, args);
  };

  const rawFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await rawFetch.apply(this, args);
    try {
      const reqUrl = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url) || "";
      if (reqUrl.includes("/user/checkin") && !reqUrl.includes("/challenge")) {
        const clone = response.clone();
        clone.json().then((data) => {
          window.__gladosCheckinResult = data;
        }).catch(() => {});
      }
    } catch (e) {}
    return response;
  };
}

// 点击官网签到按钮。按钮因还没验证而不可用时，不能当成“今天已经签过”。
async function clickOfficialCheckinButton() {
  const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  window.__gladosCheckinResult = null;

  const path = window.location.pathname || "";
  if (path.includes("login") || path.includes("authenticate")) {
    return { notLoggedIn: true };
  }

  let checkinBtn = document.querySelector("button.ckb");
  for (let i = 0; i < 6 && !checkinBtn; i++) {
    await sleepInPage(500);
    checkinBtn = document.querySelector("button.ckb");
  }
  if (!checkinBtn) return { buttonNotFound: true };

  const label = (checkinBtn.innerText || "").replace(/\s+/g, " ").trim();
  if (checkinBtn.classList.contains("is-done") || /已签到|repeats/i.test(label)) {
    return {
      success: true,
      data: { code: 1, message: label || "Checkin Repeats! Please Try Tomorrow (今日已签到)" }
    };
  }

  if (checkinBtn.disabled) {
    return { success: false, error: "签到按钮仍不可用，请先完成「请验证您是真人」" };
  }

  checkinBtn.click();

  for (let i = 0; i < 16; i++) {
    await sleepInPage(500);
    if (window.__gladosCheckinResult) {
      return { success: true, data: window.__gladosCheckinResult };
    }
    if (checkinBtn.classList.contains("is-done")) {
      return {
        success: true,
        data: { code: 0, message: (checkinBtn.innerText || "").trim() || "CheckIn! Get Points" }
      };
    }
  }

  return { success: false, error: "点击签到按钮后等待服务器响应超时" };
}

async function readPageState(tabId) {
  try {
    await chrome.tabs.get(tabId);
  } catch (error) {
    return { tabClosed: true };
  }

  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: inspectCheckinPage
    });
    return injected && injected[0] ? injected[0].result : null;
  } catch (error) {
    console.warn("读取签到页状态失败:", error);
    return null;
  }
}

async function revealCheckinTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    await chrome.tabs.update(tabId, { active: true });
    if (tab.windowId !== undefined && chrome.windows) {
      await chrome.windows.update(tab.windowId, { focused: true });
    }
  } catch (error) {
    console.warn("无法将签到页切到前台:", error);
  }
}

function notifyNeedsHuman() {
  try {
    const created = chrome.notifications.create("glados-human-check", {
      type: "basic",
      iconUrl: "icon.png",
      title: "请完成人机验证",
      message: "签到页已打开。请点击「请验证您是真人」，完成后会继续签到。"
    });
    if (created && typeof created.catch === "function") created.catch(() => {});
  } catch (error) {
    console.warn("无法发出人机验证通知:", error);
  }
}

const HUMAN_VERIFY_WAIT_MS = 90000;

async function waitForUserVerification(tabId, modeText) {
  console.log(`[${modeText}] 签到页需要人机验证，已切到前台，等待你点击「请验证您是真人」...`);
  await revealCheckinTab(tabId);
  notifyNeedsHuman();

  const deadline = Date.now() + HUMAN_VERIFY_WAIT_MS;
  while (Date.now() < deadline) {
    await sleep(1000);
    const state = await readPageState(tabId);
    const status = CheckinGate.humanWaitStatus(state);
    if (status === "ready") return { ready: true };
    if (status === "done") {
      return {
        exit: {
          success: true,
          data: {
            code: 1,
            message: (state && state.label) || "Checkin Repeats! Please Try Tomorrow (今日已签到)"
          }
        }
      };
    }
    if (status === "login") return { exit: { notLoggedIn: true } };
    if (status === "closed") return { exit: { success: false, error: "签到页已关闭，人机验证未完成" } };
  }

  return {
    exit: {
      success: false,
      error: "人机验证未完成。请在打开的签到页点击「请验证您是真人」，再点「签到」。签到页已保留。"
    }
  };
}

async function waitForInitialState(tabId) {
  let last = null;
  for (let i = 0; i < 16; i++) {
    last = await readPageState(tabId);
    if (!last || last.tabClosed || last.notLoggedIn || last.alreadyDone) return last;
    if (last.turnstile === "pending" || last.turnstile === "passed") return last;
    if (last.hasButton && i >= 8) return last;
    await sleep(500);
  }
  return last;
}

async function runInPage(tabId, func) {
  const injected = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func
  });
  return injected && injected[0] ? injected[0].result : null;
}

async function clickWhenEnabled(tabId) {
  for (let i = 0; i < 10; i++) {
    const state = await readPageState(tabId);
    if (state && state.tabClosed) return { success: false, error: "签到页已关闭" };
    if (state && state.notLoggedIn) return { notLoggedIn: true };
    if (state && state.alreadyDone) {
      return {
        success: true,
        data: { code: 1, message: state.label || "Checkin Repeats! Please Try Tomorrow (今日已签到)" }
      };
    }
    if (!state || !state.hasButton || state.buttonDisabled) {
      await sleep(300);
      continue;
    }
    return runInPage(tabId, clickOfficialCheckinButton);
  }
  return { success: false, error: "签到按钮仍不可用。请先完成「请验证您是真人」，再点击页面上的「签到」。" };
}

// ============================================================================
// 在官网签到页点击原生签到按钮。
// 出现「请验证您是真人」时，把页面交给用户本人点击，通过后再点签到。
// ============================================================================
async function executeInRealWebPage(modeText) {
  let tempTabId = null;
  let closeTabOnFinish = false;
  try {
    console.log(`[${modeText}] 正在打开官网签到页...`);

    const tab = await chrome.tabs.create({
      url: "https://glados.cloud/console/checkin",
      active: false
    });
    tempTabId = tab.id;

    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try {
        const currentTab = await chrome.tabs.get(tempTabId);
        if (currentTab && currentTab.status === "complete") break;
      } catch (e) {
        break;
      }
    }

    await runInPage(tempTabId, installCheckinResponseListener);

    let state = await waitForInitialState(tempTabId);
    if (!state || state.tabClosed) {
      return { success: false, error: "签到页加载失败或已关闭" };
    }
    if (state.notLoggedIn) return { notLoggedIn: true };
    if (state.alreadyDone) {
      closeTabOnFinish = true;
      return {
        success: true,
        data: { code: 1, message: state.label || "Checkin Repeats! Please Try Tomorrow (今日已签到)" }
      };
    }

    if (CheckinGate.needsHumanVerification(state)) {
      await sleep(3000);
      const again = await readPageState(tempTabId);
      if (again) state = again;
    }

    if (CheckinGate.needsHumanVerification(state)) {
      const waited = await waitForUserVerification(tempTabId, modeText);
      if (waited.exit) {
        if (CheckinGate.isSuccessfulCheckin(waited.exit)) closeTabOnFinish = true;
        return waited.exit;
      }
    }

    let result = await clickWhenEnabled(tempTabId);
    const afterClick = await readPageState(tempTabId);
    if (CheckinGate.isVerificationFailure(result) || CheckinGate.needsHumanVerification(afterClick)) {
      const waited = await waitForUserVerification(tempTabId, modeText);
      if (waited.exit) {
        if (CheckinGate.isSuccessfulCheckin(waited.exit)) closeTabOnFinish = true;
        return waited.exit;
      }
      result = await clickWhenEnabled(tempTabId);
    }

    if (CheckinGate.isSuccessfulCheckin(result)) closeTabOnFinish = true;
    return result;
  } catch (error) {
    console.error(`[${modeText}] 网页签到执行出错:`, error);
    return null;
  } finally {
    if (closeTabOnFinish && tempTabId !== null) {
      await sleep(1000);
      try {
        await chrome.tabs.remove(tempTabId);
        console.log(`[${modeText}] 签到完成，已关闭签到页。`);
      } catch (closeErr) {}
    }
  }
}

// ============================================================================
// 主签到入口函数
// ============================================================================
async function performFetch(today, notifyEnabled, isManual = false) {
  const modeText = isManual ? '手动测试' : '自动签到';

  try {
    await ensureHeaderRules();
    console.log(`[${modeText}] 开始执行真实网页原生点击签到流程...`);

    // 调用上面的真实网页原生点击引擎
    const pageResult = await executeInRealWebPage(modeText);

    // 情况 1：明确检测到未登录官网
    if (pageResult && pageResult.notLoggedIn) {
      await handleNotLoggedIn(modeText, notifyEnabled, isManual);
      return;
    }

    // 情况 2：没找到按钮或超时（先通过 /api/user/points 确认是不是因为未登录导致的）
    if (!pageResult || pageResult.buttonNotFound || !pageResult.success) {
      const checkLoginRes = await fetch("https://glados.cloud/api/user/points", {
        method: "GET",
        credentials: "include"
      }).catch(() => null);

      if (checkLoginRes) {
        if (checkLoginRes.status === 401 || checkLoginRes.status === 403 || checkLoginRes.redirected) {
          await handleNotLoggedIn(modeText, notifyEnabled, isManual);
          return;
        }
        const loginData = await checkLoginRes.json().catch(() => null);
        if (!loginData || loginData.code !== 0) {
          await handleNotLoggedIn(modeText, notifyEnabled, isManual);
          return;
        }
      }

      const failMsg = (pageResult && pageResult.error) ? pageResult.error : "页面加载超时或未找到签到按钮，请稍后重试";
      await saveHistory(`[${isManual ? '手动' : '自动'}] ⚠️ ${failMsg}`);
      if (notifyEnabled !== false) {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png",
          title: isManual ? "GLaDOS 手动测试异常" : "GLaDOS 自动签到异常",
          message: failMsg
        });
      }
      return;
    }

    // 情况 3：成功拿到官网原生点击后的签到结果！
    const result = pageResult.data;
    console.log(`[${modeText}] 成功捕获官网原生签到结果:`, result);

    let statusMsg = (result && result.message) ? result.message : "签到完成";
    if (result && result.points !== undefined && Number(result.points) > 0) {
      statusMsg += ` (本次获得: +${Number(result.points)} 点)`;
    } else if (result && result.list && result.list.length > 0 && result.code === 0) {
      const latestChange = parseInt(result.list[0].change, 10);
      if (!isNaN(latestChange) && latestChange > 0) {
        statusMsg += ` (本次获得: +${latestChange} 点)`;
      }
    }

    // 保存到本地历史记录
    await saveHistory(`[${isManual ? '手动' : '自动'}] ` + statusMsg);

    // 只有在“不是手动测试”的情况下，且没有报 cloudflare 错误时，才更新今日已签到标识
    if (!isManual && result) {
      const msgLower = statusMsg.toLowerCase();
      if (
        !msgLower.includes("cloudflare") && (
          result.code === 0 || 
          msgLower.includes("checkin") || 
          msgLower.includes("points") || 
          msgLower.includes("repeat") || 
          msgLower.includes("tomorrow") || 
          msgLower.includes("logged") ||
          msgLower.includes("已签到")
        )
      ) {
        await chrome.storage.local.set({ lastCheckInDate: today });
        console.log("[状态更新] 已成功记录今日自动签到日期标识:", today);
      }
    } else {
      console.log("[状态更新] 本次为手动测试，不修改自动签到日期标识。");
    }

    // 弹出系统桌面通知
    if (notifyEnabled !== false) {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icon.png",
        title: isManual ? "GLaDOS 手动测试结果" : "GLaDOS 自动签到结果",
        message: statusMsg
      });
    }

  } catch (error) {
    console.error(`[${modeText}] 签到过程发生错误:`, error);
    await saveHistory(`[${isManual ? '手动' : '自动'}] 网络连接或解析失败`);
  } finally {
    chrome.runtime.sendMessage({ action: "checkInFinished" }).catch(() => {});
  }
}

// 统一处理后台检测到未登录官网时的日志记录与通知提醒
async function handleNotLoggedIn(modeText, notifyEnabled, isManual) {
  const notLoginMsg = "签到失败：检测到当前浏览器未登录 GLaDOS 官网，请先前往官网登录账号！";
  console.warn(`[${modeText}] ${notLoginMsg}`);
  await saveHistory(`[${isManual ? '手动' : '自动'}] ⚠️ ` + notLoginMsg);

  if (notifyEnabled !== false) {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title: "GLaDOS 签到失败 (未登录)",
      message: notLoginMsg
    });
  }
}

// ============================================================================
// 本地日志保存与消息通信区域
// ============================================================================

// 保存本地历史记录的函数（最多保留最近 30 条）
async function saveHistory(msg) {
  try {
    const data = await chrome.storage.local.get({ history: [] });
    const newRecord = {
      time: new Date().toLocaleString(),
      result: msg
    };
    const newHistory = [newRecord, ...data.history].slice(0, 30);
    await chrome.storage.local.set({ history: newHistory });
  } catch (error) {
    console.error("保存历史记录失败:", error);
  }
}

// 监听来自设置页面的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // 1. 收到“手动测试签到”指令
  if (request.action === "forceCheckIn") {
    console.log("收到设置页发来的【手动测试签到】指令");
    const today = getTodayString();
    chrome.storage.local.get(["notifyEnabled"], (data) => {
      performFetch(today, data.notifyEnabled, true);
    });
    sendResponse({ status: "processing" });
  } 
  // 2. 收到“更新了设置时间”指令，重新检查并安排闹钟
  else if (request.action === "rescheduleAlarm") {
    console.log("收到设置更改通知，正在重新检查签到计划...");
    chrome.alarms.clear("randomDelayAlarm", () => {
      tryCheckIn();
    });
    sendResponse({ status: "rescheduled" });
  }
  return true;
});

// 监听插件图标左键点击事件：直接打开设置页
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});