// 解析 Server酱 SendKey，或控制台里复制的完整 .send 地址。
// 只填 SCT 开头的 SendKey 时，使用官方接口 https://sctapi.ftqq.com 。
function parseServerChanTarget(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  if (/^https?:\/\//i.test(text)) {
    let url;
    try {
      url = new URL(text);
    } catch (e) {
      return null;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.pathname.includes(".send")) return null;
    return {
      pushUrl: url.toString(),
      originPattern: `${url.origin}/*`
    };
  }

  if (!/^SCT[A-Za-z0-9]+$/.test(text)) return null;
  return {
    pushUrl: `https://sctapi.ftqq.com/${text}.send`,
    originPattern: "https://sctapi.ftqq.com/*"
  };
}
