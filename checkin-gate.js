// 签到页人机验证的状态判断。只根据页面上能不能点、官方组件有没有通过来决定下一步，
// 不生成、不读取、也不提交验证令牌。
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  root.CheckinGate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function isVerificationFailure(result) {
    if (!result) return false;
    const message = [
      result.error || "",
      result.data && result.data.message ? result.data.message : ""
    ].join(" ").toLowerCase();
    return (
      message.includes("cloudflare") ||
      message.includes("turnstile") ||
      message.includes("verification")
    );
  }

  function needsHumanVerification(state) {
    if (!state || state.notLoggedIn || state.alreadyDone || state.tabClosed) return false;
    if (state.turnstile === "passed") return false;
    if (state.turnstile === "pending") return true;
    if (state.hasButton && state.buttonDisabled) return true;
    return false;
  }

  function humanWaitStatus(state) {
    if (!state) return "retry";
    if (state.tabClosed) return "closed";
    if (state.notLoggedIn) return "login";
    if (state.alreadyDone) return "done";
    if (state.turnstile === "passed") return "ready";
    if (state.turnstile === "absent" && state.hasButton && !state.buttonDisabled) return "ready";
    return "pending";
  }

  function isSuccessfulCheckin(result) {
    return Boolean(result && result.success && !isVerificationFailure(result));
  }

  return {
    isVerificationFailure,
    needsHumanVerification,
    humanWaitStatus,
    isSuccessfulCheckin
  };
});
