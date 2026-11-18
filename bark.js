// 解析 Bark App 里复制的设备地址，例如 https://api.day.app/你的Key
// 或自建服务器 https://example.com/你的Key。推送走该地址所在服务器的 /push。
function parseBarkAddress(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;

  let url;
  try {
    url = new URL(text.includes("://") ? text : `https://${text}`);
  } catch (e) {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  const deviceKey = decodeURIComponent(parts[parts.length - 1]);
  if (!deviceKey || deviceKey.toLowerCase() === "push") return null;

  const prefix = parts.slice(0, -1).map((part) => encodeURIComponent(part)).join("/");
  return {
    pushUrl: `${url.origin}${prefix ? `/${prefix}` : ""}/push`,
    deviceKey,
    originPattern: `${url.origin}/*`
  };
}
