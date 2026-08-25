"use strict";
(() => {
  // src/renderer/view-model.ts
  var UNAVAILABLE = "\u6682\u4E0D\u53EF\u7528";
  function percentageText(value) {
    return value === null ? UNAVAILABLE : `${Math.round(value)}%`;
  }
  function toMillis(epoch) {
    return epoch < 1e11 ? epoch * 1e3 : epoch;
  }
  function formatCountdown(resetsAt, now = Date.now()) {
    if (resetsAt === null) return UNAVAILABLE;
    const remainingMs = Math.max(0, toMillis(resetsAt) - now);
    const totalMinutes = Math.ceil(remainingMs / 6e4);
    if (totalMinutes < 1) return "<1m";
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    return `${hours}h${minutes}m`;
  }
  function formatResetAt(resetsAt) {
    if (resetsAt === null) return null;
    const resetAt = new Date(toMillis(resetsAt));
    const twoDigits = (value) => String(value).padStart(2, "0");
    return `${twoDigits(resetAt.getFullYear() % 100)}Y ${twoDigits(resetAt.getMonth() + 1)}M ${twoDigits(resetAt.getDate())}D ${twoDigits(resetAt.getHours())}:${twoDigits(resetAt.getMinutes())}`;
  }
  function formatLastUpdatedAt(lastUpdatedAt, locale = "zh-CN") {
    if (lastUpdatedAt === null) return null;
    const time = new Intl.DateTimeFormat(locale, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(new Date(lastUpdatedAt));
    return `\u6700\u540E\u66F4\u65B0\u4E8E ${time}`;
  }
  function windowText(window2) {
    return percentageText(window2.remainingPercent);
  }
  function buildRendererViewModel(state, now = Date.now()) {
    const missingStatusText = state.status === "loading" ? "\u5237\u65B0\u4E2D\u2026" : state.status === "error" ? "\u8FDE\u63A5\u5931\u8D25" : UNAVAILABLE;
    const fiveHour = state.fiveHour ?? { remainingPercent: null, resetsAt: null, windowDurationMins: null };
    const weekly = state.weekly ?? { remainingPercent: null, resetsAt: null, windowDurationMins: null };
    const hasFiveHour = fiveHour.remainingPercent !== null;
    const hasWeekly = weekly.remainingPercent !== null;
    const fiveHourText = hasFiveHour ? windowText(fiveHour) : missingStatusText;
    const weeklyText = hasWeekly ? windowText(weekly) : missingStatusText;
    const resetCount = state.resetCredits?.availableCount ?? null;
    return {
      fiveHourRingPercent: fiveHour.remainingPercent ?? 0,
      weeklyRingPercent: weekly.remainingPercent ?? 0,
      ringPercent: weekly.remainingPercent ?? 0,
      centerText: weeklyText,
      fiveHourText,
      weeklyText,
      fiveHourCountdown: hasFiveHour ? formatCountdown(fiveHour.resetsAt, now) : missingStatusText,
      weeklyCountdown: hasWeekly ? formatCountdown(weekly.resetsAt, now) : missingStatusText,
      fiveHourResetAtText: hasFiveHour ? formatResetAt(fiveHour.resetsAt) : null,
      weeklyResetAtText: hasWeekly ? formatResetAt(weekly.resetsAt) : null,
      lastUpdatedText: formatLastUpdatedAt(state.lastUpdatedAt),
      refreshDisabled: state.status === "loading",
      resetCountText: resetCount === null ? UNAVAILABLE : String(Math.max(0, Math.floor(resetCount))),
      resetDisabled: resetCount === null || resetCount <= 0 || state.isResetting || state.status === "loading",
      note: state.status === "loading" ? "\u6B63\u5728\u5237\u65B0\u2026" : state.errorMessage
    };
  }

  // src/renderer/click-arbiter.ts
  function createClickArbiter(onSingleClick, delayMs = 220) {
    let timer;
    const cancelSingle = () => {
      if (timer !== void 0) clearTimeout(timer);
      timer = void 0;
    };
    return {
      scheduleSingle() {
        cancelSingle();
        timer = setTimeout(() => {
          timer = void 0;
          onSingleClick();
        }, delayMs);
      },
      cancelSingle,
      dispose: cancelSingle
    };
  }

  // src/renderer/renderer.ts
  async function requestQuotaReset(api, confirmReset) {
    if (!confirmReset()) return false;
    await api.resetQuota();
    return true;
  }
  function setProgress(element, percent) {
    element.style.setProperty("--progress", `${Math.max(0, Math.min(100, percent))}%`);
  }
  function renderResetTiming(countdown, resetAt, countdownText, resetAtText) {
    countdown.textContent = countdownText;
    resetAt.textContent = resetAtText ?? "";
    resetAt.hidden = resetAtText === null;
  }
  function mountRenderer(root, api, now = Date.now) {
    const orb = root.querySelector('[data-action="toggle-pin"]');
    const details = root.querySelector("[data-details]");
    const refresh = root.querySelector('[data-action="refresh"]');
    const reset = root.querySelector('[data-action="reset"]');
    const resetCount = root.querySelector("[data-reset-count]");
    const edgeHandle = root.querySelector('[data-action="restore-from-edge"]');
    const fiveHourRing = root.querySelector('[data-window="five-hour"]');
    const weeklyRing = root.querySelector('[data-window="weekly"]');
    const fiveHourCenter = root.querySelector('[data-center="five-hour"]');
    const weeklyCenter = root.querySelector('[data-center="weekly"]');
    const fiveHourText = root.querySelector('[data-value="five-hour"]');
    const weeklyText = root.querySelector('[data-value="weekly"]');
    const fiveHourCountdown = root.querySelector('[data-countdown="five-hour"]');
    const fiveHourResetAt = root.querySelector('[data-reset-at="five-hour"]');
    const weeklyCountdown = root.querySelector('[data-countdown="weekly"]');
    const weeklyResetAt = root.querySelector('[data-reset-at="weekly"]');
    const lastUpdated = root.querySelector("[data-last-updated]");
    const fallback = root.querySelector("[data-accessible-status]");
    const note = root.querySelector("[data-note]");
    if (!orb || !details || !refresh || !reset || !resetCount || !edgeHandle || !fiveHourRing || !weeklyRing || !fiveHourCenter || !weeklyCenter || !fiveHourText || !weeklyText || !fiveHourCountdown || !fiveHourResetAt || !weeklyCountdown || !weeklyResetAt || !lastUpdated || !fallback || !note) {
      throw new Error("Quota renderer markup is incomplete");
    }
    let interaction = "collapsed";
    let dragStartScreenY;
    let dragPointerOffsetY = 0;
    let movedDuringDrag = false;
    const renderInteraction = () => {
      root.dataset.state = interaction;
      root.classList.toggle("is-collapsed", interaction === "collapsed");
      root.classList.toggle("is-pinned", interaction === "pinned");
      orb.setAttribute("aria-expanded", String(interaction !== "collapsed"));
    };
    const renderState = (state) => {
      const model = buildRendererViewModel(state, now());
      setProgress(fiveHourRing, model.fiveHourRingPercent);
      setProgress(weeklyRing, model.weeklyRingPercent);
      fiveHourRing.setAttribute("aria-label", `Five-hour remaining ${model.fiveHourText}`);
      weeklyRing.setAttribute("aria-label", `Weekly remaining ${model.weeklyText}`);
      fiveHourCenter.textContent = model.fiveHourText;
      weeklyCenter.textContent = model.weeklyText;
      fiveHourText.textContent = model.fiveHourText;
      weeklyText.textContent = model.weeklyText;
      renderResetTiming(fiveHourCountdown, fiveHourResetAt, model.fiveHourCountdown, model.fiveHourResetAtText);
      renderResetTiming(weeklyCountdown, weeklyResetAt, model.weeklyCountdown, model.weeklyResetAtText);
      lastUpdated.textContent = model.lastUpdatedText ?? "";
      lastUpdated.hidden = model.lastUpdatedText === null;
      refresh.disabled = model.refreshDisabled;
      resetCount.textContent = model.resetCountText;
      reset.disabled = model.resetDisabled;
      note.textContent = model.note ?? "";
      note.hidden = model.note === null;
      fallback.textContent = `5 Hours ${model.fiveHourText}. Weekly ${model.weeklyText}.`;
    };
    const onPointerEnter = () => {
      if (dragStartScreenY !== void 0) return;
      if (interaction !== "pinned") {
        interaction = "hoverOpen";
        renderInteraction();
      }
    };
    const onDetailsLeave = () => {
      if (interaction !== "pinned") {
        interaction = "collapsed";
        renderInteraction();
      }
    };
    const togglePinned = () => {
      interaction = interaction === "pinned" ? "collapsed" : "pinned";
      renderInteraction();
    };
    const hideToEdge = () => {
      interaction = "collapsed";
      renderInteraction();
      void api.setEdgeHidden(true);
    };
    const clickArbiter = createClickArbiter(togglePinned);
    const onOrbClick = () => {
      if (movedDuringDrag) {
        clickArbiter.cancelSingle();
        return;
      }
      clickArbiter.scheduleSingle();
    };
    const onOrbDoubleClick = () => {
      clickArbiter.cancelSingle();
      if (movedDuringDrag) return;
      hideToEdge();
    };
    const onOrbPointerDown = (event) => {
      if (event.button !== 0) return;
      clickArbiter.cancelSingle();
      if (interaction !== "pinned") {
        interaction = "collapsed";
        renderInteraction();
      }
      dragStartScreenY = event.screenY;
      dragPointerOffsetY = event.clientY;
      movedDuringDrag = false;
      void api.startDrag(dragPointerOffsetY);
      orb.setPointerCapture?.(event.pointerId);
    };
    const onOrbPointerMove = (event) => {
      if (dragStartScreenY === void 0) return;
      if (Math.abs(event.screenY - dragStartScreenY) > 3) movedDuringDrag = true;
      if (movedDuringDrag) {
        clickArbiter.cancelSingle();
        void api.moveToY(event.screenY, dragPointerOffsetY);
      }
    };
    const onOrbPointerUp = (event) => {
      dragStartScreenY = void 0;
      void api.stopDrag();
      orb.releasePointerCapture?.(event.pointerId);
    };
    const onRefresh = () => {
      if (!refresh.disabled) void api.refreshNow();
    };
    const onReset = () => {
      if (reset.disabled) return;
      reset.disabled = true;
      void requestQuotaReset(
        api,
        () => window.confirm("Use one quota reset? This cannot be undone.")
      ).then((confirmed) => {
        if (!confirmed) reset.disabled = false;
      }).catch(() => void 0);
    };
    const onRestoreFromEdge = () => {
      void api.setEdgeHidden(false);
    };
    const renderEdgeHidden = (hidden) => {
      interaction = "collapsed";
      renderInteraction();
      root.classList.toggle("is-edge-hidden", hidden);
    };
    root.addEventListener("pointerenter", onPointerEnter);
    details.addEventListener("pointerleave", onDetailsLeave);
    orb.addEventListener("click", onOrbClick);
    orb.addEventListener("dblclick", onOrbDoubleClick);
    orb.addEventListener("pointerdown", onOrbPointerDown);
    window.addEventListener("pointermove", onOrbPointerMove);
    window.addEventListener("pointerup", onOrbPointerUp);
    refresh.addEventListener("click", onRefresh);
    reset.addEventListener("click", onReset);
    edgeHandle.addEventListener("click", onRestoreFromEdge);
    renderInteraction();
    const unsubscribe = api.subscribe(renderState);
    const unsubscribeEdgeHidden = api.subscribeEdgeHidden(renderEdgeHidden);
    return () => {
      unsubscribe();
      unsubscribeEdgeHidden();
      root.removeEventListener("pointerenter", onPointerEnter);
      details.removeEventListener("pointerleave", onDetailsLeave);
      orb.removeEventListener("click", onOrbClick);
      orb.removeEventListener("dblclick", onOrbDoubleClick);
      orb.removeEventListener("pointerdown", onOrbPointerDown);
      window.removeEventListener("pointermove", onOrbPointerMove);
      window.removeEventListener("pointerup", onOrbPointerUp);
      refresh.removeEventListener("click", onRefresh);
      reset.removeEventListener("click", onReset);
      edgeHandle.removeEventListener("click", onRestoreFromEdge);
      clickArbiter.dispose();
    };
  }
  if (typeof document !== "undefined") {
    const root = document.querySelector("[data-quota-app]");
    if (root && window.quota) mountRenderer(root, window.quota);
  }
})();
