const assert = require("assert");
const fs = require("fs");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`missing ${name}`);
  let open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unclosed ${name}`);
}

class Node {
  constructor(tag, attrs = {}) {
    this.tag = tag;
    this.attrs = attrs;
    this.children = [];
    this.shadowRoot = null;
    this.value = attrs.value || "";
    this.disabled = Boolean(attrs.disabled);
    this.innerText = attrs.innerText || "";
    this.className = attrs.className || "";
  }

  get classList() {
    const names = this.className.split(/\s+/).filter(Boolean);
    return { contains: (name) => names.includes(name) };
  }

  append(child) {
    this.children.push(child);
    return child;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const parts = selector.split(",").map((part) => part.trim());
    const out = [];
    const walk = (node) => {
      if (node !== this && parts.some((part) => matches(node, part))) out.push(node);
      node.children.forEach(walk);
    };
    walk(this);
    return out;
  }
}

function matches(node, selector) {
  if (selector === "*") return true;
  if (selector === "button.ckb") return node.tag === "button" && node.classList.contains("ckb");
  if (selector === ".cf-turnstile") return node.classList.contains("cf-turnstile");
  if (selector === "[data-sitekey]") return Object.prototype.hasOwnProperty.call(node.attrs, "data-sitekey");
  if (selector === 'iframe[src*="challenges.cloudflare.com"]') {
    return node.tag === "iframe" && String(node.attrs.src || "").includes("challenges.cloudflare.com");
  }
  if (selector === 'textarea[name="cf-turnstile-response"]') {
    return node.tag === "textarea" && node.attrs.name === "cf-turnstile-response";
  }
  if (selector === 'input[name="cf-turnstile-response"]') {
    return node.tag === "input" && node.attrs.name === "cf-turnstile-response";
  }
  return false;
}

const source = fs.readFileSync(`${__dirname}/background.js`, "utf8");
const inspect = new Function(
  `${extractFunction(source, "inspectCheckinPage")}; return inspectCheckinPage();`
);

function run(document, pathname = "/console/checkin") {
  global.window = { location: { pathname } };
  global.document = document;
  return inspect();
}

function pageWithWidget({ token = "", disabled = false, className = "ckb", innerText = "签到" } = {}) {
  const document = new Node("#document");
  const widget = new Node("div", { className: "cf-turnstile" });
  widget.append(new Node("iframe", {
    src: "https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/g/turnstile/f/ov2/av0/rch"
  }));
  widget.append(new Node("input", { name: "cf-turnstile-response", value: token }));
  document.append(widget);
  document.append(new Node("button", { className, innerText, disabled }));
  return document;
}

const pending = run(pageWithWidget());
assert.strictEqual(pending.turnstile, "pending");
assert.strictEqual(pending.alreadyDone, false);
assert.strictEqual(pending.hasButton, true);
assert.strictEqual(pending.buttonDisabled, false);

const disabled = run(pageWithWidget({ disabled: true }));
assert.strictEqual(disabled.alreadyDone, false);
assert.strictEqual(disabled.buttonDisabled, true);
assert.strictEqual(disabled.turnstile, "pending");

const passed = run(pageWithWidget({ token: "already-solved-by-user" }));
assert.strictEqual(passed.turnstile, "passed");
assert.strictEqual(passed.alreadyDone, false);

const done = run(pageWithWidget({ className: "ckb is-done", innerText: "已签到" }));
assert.strictEqual(done.alreadyDone, true);

const hiddenToken = new Node("#document");
const host = new Node("div");
const shadow = new Node("shadow");
shadow.append(new Node("input", { name: "cf-turnstile-response", value: "from-shadow" }));
host.shadowRoot = shadow;
hiddenToken.append(host);
hiddenToken.append(new Node("button", { className: "ckb", innerText: "签到" }));
assert.strictEqual(run(hiddenToken).turnstile, "passed");

const login = run(new Node("#document"), "/login");
assert.strictEqual(login.notLoggedIn, true);

console.log("inspect-checkin tests passed");
