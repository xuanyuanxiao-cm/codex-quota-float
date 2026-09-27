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
      showFiveHour: state.hasFiveHour !== false,
      planText: state.planType === 'pro' ? 'Pro' : state.planType === 'plus' ? 'Plus' : state.planType || (state.status === 'loading' ? '正在识别套餐…' : '套餐未确认'),
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
      resetDisabled: resetCount === null || resetCount <= 0 || !state.resetCredits.credits.some((credit) => credit.status === "available") || state.isResetting || state.status === "loading",
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
    const creditPicker = root.querySelector("[data-credit-picker]");
    const creditList = root.querySelector("[data-credit-list]");
    const pickerSelection = root.querySelector("[data-picker-selection]");
    const creditError = root.querySelector("[data-credit-error]");
    const cancelReset = root.querySelector('[data-action="cancel-reset"]');
    const confirmReset = root.querySelector('[data-action="confirm-reset"]');
    const edgeHandle = root.querySelector('[data-action="restore-from-edge"]');
    const fiveHourRing = root.querySelector('[data-window="five-hour"]');
    const fiveHourRow = root.querySelector('[data-detail-window="five-hour"]');
    const centerDivider = root.querySelector('.center-divider');
    const planLabel = root.querySelector('[data-plan]');
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
    const orbLow = root.querySelector("[data-orb-low]");
    const orbRecovered = root.querySelector("[data-orb-recovered]");
    const orbExpiring = root.querySelector("[data-orb-expiring]");
    const expiryButton = root.querySelector('[data-action="expiring-credits"]');
    const expirySummary = root.querySelector("[data-expiry-summary]");
    const trendsButton = root.querySelector('[data-action="trends"]');
    const noticesButton = root.querySelector('[data-action="notices"]');
    const orbNotice = root.querySelector('[data-orb-notice]');
    const noticeSummary = root.querySelector('[data-notice-summary]');
    const probabilityTag = root.querySelector('[data-probability-tag]');
    const probabilityPanel = root.querySelector('[data-probability-panel]');
    const alertSummary = root.querySelector('[data-alert-summary]');
    let latestNotices;
    if (!orb || !details || !refresh || !reset || !resetCount || !creditPicker || !creditList || !pickerSelection || !creditError || !cancelReset || !confirmReset || !edgeHandle || !fiveHourRing || !weeklyRing || !fiveHourCenter || !weeklyCenter || !fiveHourText || !weeklyText || !fiveHourCountdown || !fiveHourResetAt || !weeklyCountdown || !weeklyResetAt || !lastUpdated || !fallback || !note) {
      throw new Error("Quota renderer markup is incomplete");
    }
    let interaction = "collapsed";
    let latestState;
    let selectedCreditId;
    let resetPending = false;
    let edgeHidden = false;
    let lastLayout;
    let dragStartScreenY;
    let dragPointerOffsetY = 0;
    let movedDuringDrag = false;
    const syncWindowLayout = () => {
      if (alertSummary) {
        const messages = [];
        if (latestState?.alerts?.quotaBadge) messages.push(latestState.alerts.quotaBadge.text);
        const credits = (latestState?.alerts?.creditBadges ?? []).filter(c => c.expiresAt > now());
        if (credits.length) messages.push(`${credits.length} 张重置卡将在 24 小时内到期`);
        if (latestNotices?.unread) messages.push(`${latestNotices.unread} 条新核验公告待查看`);
        if (messages.length && ['stale', 'error'].includes(latestState?.status)) messages.push('更新失败，以上为最近一次数据');
        alertSummary.textContent = messages.join('\n');
        alertSummary.hidden = !messages.length || interaction !== 'collapsed' || edgeHidden || !creditPicker.hidden;
        root.classList.toggle('has-alert-summary', !alertSummary.hidden);
      }
      if (edgeHidden) return;
      const mode = !creditPicker.hidden ? "picker" : interaction === "pinned" ? "normal" : alertSummary && !alertSummary.hidden ? "summary" : "collapsed";
      const elements = mode === "picker" ? [details] : mode === "normal" ? [orb, details] : [orb];
      if (mode === 'summary') elements.push(alertSummary);
      if (mode !== "picker") elements.push(...[orbLow, orbRecovered, orbExpiring, orbNotice].filter((element) => element && !element.hidden));
      if (mode !== "picker" && probabilityTag && !probabilityTag.hidden) elements.push(probabilityTag);
      const regions = elements.map((element) => {
        const { x, y, width, height } = element.getBoundingClientRect();
        const radius = Math.min(parseFloat(window.getComputedStyle(element).borderTopLeftRadius) || 0, width / 2, height / 2);
        return { x, y, width, height, radius };
      });
      const layout = { mode, height: Math.ceil(root.getBoundingClientRect().height), regions };
      const key = JSON.stringify(layout);
      if (key !== lastLayout) {
        lastLayout = key;
        void api.setLayout(layout);
      }
    };
    const renderInteraction = () => {
      root.dataset.state = interaction;
      root.classList.toggle("is-collapsed", interaction === "collapsed");
      root.classList.toggle("is-pinned", interaction === "pinned");
      orb.setAttribute("aria-expanded", String(interaction !== "collapsed"));
      syncWindowLayout();
    };
    const availableCredits = (state) => state.resetCredits?.credits.filter((credit) => credit.status === "available") ?? [];
    const creditName = (index) => `重置卡 ${index + 1}`;
    const renderCreditPicker = (state) => {
      const credits = availableCredits(state);
      if (!credits.some((credit) => credit.id === selectedCreditId)) selectedCreditId = credits[0]?.id;
      creditList.replaceChildren(...credits.map((credit, index) => {
        const option = document.createElement("button");
        option.type = "button";
        option.className = "credit-option";
        option.dataset.creditId = credit.id;
        option.setAttribute("aria-pressed", String(credit.id === selectedCreditId));
        const name = document.createElement("span");
        name.textContent = creditName(index);
        const expiry = document.createElement("span");
        const expiryText = Number.isFinite(credit.expiresAt)
          ? `${new Date(toMillis(credit.expiresAt)).toLocaleDateString("zh-CN")} 到期`
          : "到期时间未知";
        expiry.textContent = `${expiryText} · 编号 …${credit.id.slice(-4)}`;
        option.append(name, expiry);
        if (Number.isFinite(credit.expiresAt) && toMillis(credit.expiresAt) > now() && toMillis(credit.expiresAt) - now() <= 86400000) {
          const warning = document.createElement("span");
          warning.className = "credit-expiring";
          warning.textContent = `即将过期 · 剩余 ${formatCountdown(credit.expiresAt, now())}`;
          option.append(warning);
        }
        option.addEventListener("click", () => {
          selectedCreditId = credit.id;
          creditError.hidden = true;
          renderCreditPicker(latestState);
        });
        return option;
      }));
      const selected = credits.find((credit) => credit.id === selectedCreditId);
      pickerSelection.textContent = selected ? `将使用：${creditName(credits.indexOf(selected))}` : "没有可用重置卡";
      confirmReset.disabled = !selected || state.isResetting || resetPending;
    };
    const closeCreditPicker = () => {
      creditPicker.hidden = true;
      root.classList.toggle("is-picking", false);
      creditError.hidden = true;
      syncWindowLayout();
    };
    const renderState = (state) => {
      latestState = state;
      const model = buildRendererViewModel(state, now());
      root.classList.toggle('is-weekly-only', !model.showFiveHour);
      fiveHourRing.hidden = !model.showFiveHour;
      fiveHourCenter.hidden = !model.showFiveHour;
      if (fiveHourRow) fiveHourRow.hidden = !model.showFiveHour;
      if (centerDivider) centerDivider.hidden = !model.showFiveHour;
      if (planLabel) planLabel.textContent = model.planText;
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
      fallback.textContent = `${model.planText}. ${model.showFiveHour ? `5 Hours ${model.fiveHourText}. ` : ''}Weekly ${model.weeklyText}.`;
      const alertWindows = state.alerts?.windows ?? {};
      const badge = state.alerts?.quotaBadge;
      const low = badge && badge.severity !== 'recovered';
      const recovered = badge?.severity === 'recovered';
      const expiring = (state.alerts?.expiringCredits ?? []).filter((credit) => credit.expiresAt > now());
      const pendingCredits = (state.alerts?.creditBadges ?? []).filter(c => c.expiresAt > now());
      if (orbLow) {
        orbLow.hidden = !low;
        orbLow.className = `orb-alert alert-${badge?.severity ?? 'low'}`;
        orbLow.title = badge?.text ?? '';
        orbLow.setAttribute('aria-label', badge?.text ?? '查看额度详情');
      }
      if (orbRecovered) orbRecovered.hidden = low || !recovered;
      if (orbExpiring) orbExpiring.hidden = pendingCredits.length === 0;
      const alertDescription = [badge?.text, pendingCredits.length ? `${pendingCredits.length} 张重置卡即将过期` : ""].filter(Boolean).join("；");
      orb.setAttribute("title", alertDescription || "点击查看额度详情");
      orb.setAttribute("aria-label", alertDescription ? `查看额度详情：${alertDescription}` : "查看额度详情");
      for (const key of ["fiveHour", "weekly"]) {
        const label = root.querySelector(`[data-alert-window="${key}"]`);
        if (!label) continue;
        const alert = alertWindows[key];
        label.hidden = !alert?.low;
        label.className = `quota-alert alert-${alert?.severity ?? 'low'}`;
        label.textContent = alert?.exhausted ? "● 额度已用尽" : alert?.severity === 'critical' ? '● 额度余量很低' : "● 额度偏低";
      }
      if (expiryButton) expiryButton.hidden = expiring.length === 0;
      if (expirySummary) expirySummary.textContent = expiring.length ? `${expiring.length} 张即将过期 · 最快 ${formatCountdown(expiring[0].expiresAt, now())} ›` : "";
      if (!creditPicker.hidden) renderCreditPicker(state);
      syncWindowLayout();
    };
    const openQuotaDetails = () => {
      interaction = 'pinned';
      renderInteraction();
      void api.dismissAlert?.('quota');
    };
    const togglePinned = () => {
      interaction = interaction === "pinned" ? "collapsed" : "pinned";
      renderInteraction();
      if (interaction === 'pinned') void api.dismissAlert?.('quota');
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
      selectedCreditId = void 0;
      creditError.hidden = true;
      creditPicker.hidden = false;
      root.classList.toggle("is-picking", true);
      interaction = 'pinned';
      renderCreditPicker(latestState);
      renderInteraction();
      void api.dismissAlert?.('credits');
    };
    const onCancelReset = () => {
      if (!resetPending) closeCreditPicker();
    };
    const onConfirmReset = async () => {
      if (confirmReset.disabled || !selectedCreditId) return;
      resetPending = true;
      confirmReset.disabled = true;
      try {
        const result = await api.resetQuota(selectedCreditId);
        if (result?.outcome === "reset" || result?.outcome === "alreadyRedeemed") {
          closeCreditPicker();
        } else if (result?.outcome !== "cancelled") {
          creditError.textContent = "未完成重置，请刷新后重试";
          creditError.hidden = false;
        }
      } catch {
        creditError.textContent = latestState?.errorMessage ?? "额度重置失败，请稍后重试";
        creditError.hidden = false;
      } finally {
        resetPending = false;
        if (!creditPicker.hidden) renderCreditPicker(latestState);
      }
    };
    const onRestoreFromEdge = () => {
      void api.setEdgeHidden(false);
    };
    const renderEdgeHidden = (hidden) => {
      edgeHidden = hidden;
      interaction = "collapsed";
      root.classList.toggle("is-edge-hidden", hidden);
      closeCreditPicker();
      renderInteraction();
    };
    orb.addEventListener("click", onOrbClick);
    orb.addEventListener("dblclick", onOrbDoubleClick);
    orb.addEventListener("pointerdown", onOrbPointerDown);
    window.addEventListener("pointermove", onOrbPointerMove);
    window.addEventListener("pointerup", onOrbPointerUp);
    refresh.addEventListener("click", onRefresh);
    reset.addEventListener("click", onReset);
    const onTrends = () => { void api.openTrends(); };
    trendsButton?.addEventListener("click", onTrends);
    const onNotices = () => { void api.openNotices?.(); };
    noticesButton?.addEventListener("click", onNotices);
    orbNotice?.addEventListener('click', onNotices);
    orbLow?.addEventListener('click', openQuotaDetails);
    orbRecovered?.addEventListener('click', openQuotaDetails);
    orbExpiring?.addEventListener('click', onReset);
    probabilityTag?.addEventListener("click", onNotices);
    probabilityPanel?.addEventListener("click", onNotices);
    const renderNotices = (state) => {
      latestNotices = state;
      if (orbNotice) orbNotice.hidden = !state.unread;
      if (noticeSummary) noticeSummary.textContent = !state.enabled ? "自动检查已关闭" : state.error ? "更新失败 · 点击查看" : state.unread ? `${state.unread} 条新公告 · 账户待确认` : state.loading ? "正在检查公告…" : state.records?.length ? "查看公告与账户状态 ›" : "暂无新动态 ›";
      const presentation = window.noticePresentation(state, now());
      if (probabilityTag) {
        probabilityTag.hidden = state.showProbability !== true;
        probabilityTag.textContent = presentation.tag;
        probabilityTag.title = `${presentation.heading} · ${presentation.note}`;
      }
      const probabilityValue = root.querySelector('[data-probability-value]');
      const probabilityNote = root.querySelector('[data-probability-note]');
      const probabilityHeading = root.querySelector('[data-probability-heading]');
      if (probabilityHeading) probabilityHeading.textContent = presentation.heading;
      if (probabilityValue) probabilityValue.textContent = presentation.value;
      if (probabilityNote) probabilityNote.textContent = presentation.note;
      syncWindowLayout();
    };
    const unsubscribeNotices = api.subscribeNotices?.(renderNotices);
    api.readNotices?.().then(renderNotices).catch(() => { if (noticeSummary) noticeSummary.textContent = "暂时无法读取 · 点击重试"; });
    expiryButton?.addEventListener("click", onReset);
    cancelReset.addEventListener("click", onCancelReset);
    confirmReset.addEventListener("click", onConfirmReset);
    edgeHandle.addEventListener("click", onRestoreFromEdge);
    renderInteraction();
    const resizeObserver = new ResizeObserver(syncWindowLayout);
    resizeObserver.observe(root);
    const unsubscribe = api.subscribe(renderState);
    const unsubscribeWorkAreaHeight = api.subscribeWorkAreaHeight?.((height) => {
      root.style.setProperty('--work-area-height', `${height}px`);
      syncWindowLayout();
    });
    const unsubscribeEdgeHidden = api.subscribeEdgeHidden(renderEdgeHidden);
    const unsubscribeOpenDetails = api.subscribeOpenDetails?.((target) => {
      if (target === "credits") onReset();
      else openQuotaDetails();
    });
    const clockTimer = window.setInterval?.(() => {
      if (latestState) renderState(latestState);
      if (latestNotices) renderNotices(latestNotices);
    }, 30000);
    return () => {
      unsubscribe();
      unsubscribeWorkAreaHeight?.();
      unsubscribeEdgeHidden();
      unsubscribeOpenDetails?.();
      unsubscribeNotices?.();
      noticesButton?.removeEventListener("click", onNotices);
      orbNotice?.removeEventListener('click', onNotices);
      orbLow?.removeEventListener('click', openQuotaDetails);
      orbRecovered?.removeEventListener('click', openQuotaDetails);
      orbExpiring?.removeEventListener('click', onReset);
      probabilityTag?.removeEventListener("click", onNotices);
      probabilityPanel?.removeEventListener("click", onNotices);
      window.clearInterval?.(clockTimer);
      resizeObserver.disconnect();
      orb.removeEventListener("click", onOrbClick);
      orb.removeEventListener("dblclick", onOrbDoubleClick);
      orb.removeEventListener("pointerdown", onOrbPointerDown);
      window.removeEventListener("pointermove", onOrbPointerMove);
      window.removeEventListener("pointerup", onOrbPointerUp);
      refresh.removeEventListener("click", onRefresh);
      reset.removeEventListener("click", onReset);
      trendsButton?.removeEventListener("click", onTrends);
      expiryButton?.removeEventListener("click", onReset);
      cancelReset.removeEventListener("click", onCancelReset);
      confirmReset.removeEventListener("click", onConfirmReset);
      edgeHandle.removeEventListener("click", onRestoreFromEdge);
      clickArbiter.dispose();
    };
  }
  if (typeof document !== "undefined") {
    const root = document.querySelector("[data-quota-app]");
    if (root && window.quota) mountRenderer(root, window.quota);
  }
})();
