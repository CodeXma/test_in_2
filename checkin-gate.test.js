const assert = require("assert");
const {
  isVerificationFailure,
  needsHumanVerification,
  humanWaitStatus,
  isSuccessfulCheckin
} = require("./checkin-gate.js");

assert.strictEqual(needsHumanVerification(null), false);
assert.strictEqual(needsHumanVerification({ notLoggedIn: true, turnstile: "pending" }), false);
assert.strictEqual(needsHumanVerification({ alreadyDone: true, turnstile: "pending" }), false);
assert.strictEqual(needsHumanVerification({ tabClosed: true, turnstile: "pending" }), false);
assert.strictEqual(needsHumanVerification({ turnstile: "pending" }), true);
assert.strictEqual(
  needsHumanVerification({ turnstile: "passed", hasButton: true, buttonDisabled: true }),
  false
);
assert.strictEqual(
  needsHumanVerification({ turnstile: "absent", hasButton: true, buttonDisabled: true }),
  true
);
assert.strictEqual(
  needsHumanVerification({ turnstile: "absent", hasButton: true, buttonDisabled: false }),
  false
);
assert.strictEqual(needsHumanVerification({ turnstile: "absent", hasButton: false }), false);

assert.strictEqual(humanWaitStatus(null), "retry");
assert.strictEqual(humanWaitStatus({ tabClosed: true }), "closed");
assert.strictEqual(humanWaitStatus({ notLoggedIn: true }), "login");
assert.strictEqual(humanWaitStatus({ alreadyDone: true }), "done");
assert.strictEqual(humanWaitStatus({ turnstile: "passed" }), "ready");
assert.strictEqual(
  humanWaitStatus({ turnstile: "absent", hasButton: true, buttonDisabled: false }),
  "ready"
);
assert.strictEqual(
  humanWaitStatus({ turnstile: "pending", hasButton: true, buttonDisabled: true }),
  "pending"
);
assert.strictEqual(
  humanWaitStatus({ turnstile: "absent", hasButton: true, buttonDisabled: true }),
  "pending"
);

assert.strictEqual(isVerificationFailure(null), false);
assert.strictEqual(isVerificationFailure({ error: "点击签到按钮后等待服务器响应超时" }), false);
assert.strictEqual(
  isVerificationFailure({ data: { message: "Cloudflare verification failed" } }),
  true
);
assert.strictEqual(isVerificationFailure({ error: "签到按钮仍不可用，请先完成「请验证您是真人」" }), false);
assert.strictEqual(isVerificationFailure({ data: { message: "CheckIn! Get Points" } }), false);
assert.strictEqual(isVerificationFailure({ data: { message: "Turnstile token missing" } }), true);

assert.strictEqual(
  isSuccessfulCheckin({ success: true, data: { code: 0, message: "CheckIn! Get Points" } }),
  true
);
assert.strictEqual(
  isSuccessfulCheckin({ success: true, data: { message: "Cloudflare verification failed" } }),
  false
);
assert.strictEqual(isSuccessfulCheckin({ success: false, error: "超时" }), false);
assert.strictEqual(isSuccessfulCheckin(null), false);
assert.strictEqual(
  isSuccessfulCheckin({
    success: true,
    data: { code: 1, message: "Checkin Repeats! Please Try Tomorrow (今日已签到)" }
  }),
  true
);

console.log("checkin-gate tests passed");
