"use strict";
(() => {
  const chart = document.getElementById('chart');
  const tooltip = document.getElementById('tooltip');
  const empty = document.getElementById('empty');
  const events = document.getElementById('events');
  const NS = 'http://www.w3.org/2000/svg';
  let hours = 24;
  let history = { samples: [], now: Date.now() };
  let visible = [];
  let hasFiveHour = false;
  let start, end;
  const left = 53, right = 878, top = 32, bottom = 260;
  const x = (at) => left + (at - start) / (end - start) * (right - left);
  const y = (percent) => bottom - percent / 100 * (bottom - top);
  const dateText = (at) => new Date(at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  const kinds = { manual: ['◷', '手动重置', '#f97316'], period: ['✓', '周期恢复', '#34d399'], increase: ['↑', '额度回升', '#a7bad4'] };
  function svg(tag, attrs, text) {
    const node = document.createElementNS(NS, tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    if (text !== undefined) node.textContent = text;
    chart.append(node);
    return node;
  }
  function render() {
    end = history.now;
    start = end - hours * 3600000;
    visible = history.samples.filter((sample) => sample.at >= start && sample.at <= end);
    hasFiveHour = visible.some((sample) => Number.isFinite(sample.fiveHour?.remainingPercent));
    document.getElementById('five-hour-legend').hidden = !hasFiveHour;
    chart.replaceChildren();
    tooltip.hidden = true;
    empty.hidden = visible.length > 0;
    for (const percent of [0, 25, 50, 75, 100]) {
      svg('line', { x1: left, x2: right, y1: y(percent), y2: y(percent), stroke: '#263b56' });
      svg('text', { x: left - 10, y: y(percent) + 4, 'text-anchor': 'end' }, `${percent}%`);
    }
    for (let i = 0; i <= 6; i++) {
      const at = start + (end - start) * i / 6;
      svg('text', { x: x(at), y: bottom + 27, 'text-anchor': i === 0 ? 'start' : i === 6 ? 'end' : 'middle' }, hours === 24 ? new Date(at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : new Date(at).toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }));
    }
    for (let i = 1; i < visible.length; i++) {
      const a = visible[i - 1], b = visible[i];
      if (b.gapBefore || b.at - a.at > 660000) {
        svg('rect', { x: x(a.at), y: top, width: x(b.at) - x(a.at), height: bottom - top, fill: '#a7bad4', opacity: '.045' });
        if (x(b.at) - x(a.at) > 55) svg('text', { x: (x(a.at) + x(b.at)) / 2, y: (top + bottom) / 2, 'text-anchor': 'middle' }, '无记录');
      }
    }
    for (const [key, color] of [['fiveHour', '#37a7ff'], ['weekly', '#8e5cff']]) {
      if (key === 'fiveHour' && !hasFiveHour) continue;
      let path = '', previous;
      for (const sample of visible) {
        const value = sample[key]?.remainingPercent;
        if (!Number.isFinite(value)) { previous = undefined; continue; }
        const split = !previous || sample.gapBefore || sample.events?.[key] || sample.at - previous.at > 660000;
        path += split ? ` M ${x(sample.at)} ${y(value)}` : ` H ${x(sample.at)} V ${y(value)}`;
        if (split) svg('circle', { cx: x(sample.at), cy: y(value), r: 2.5, fill: color });
        previous = sample;
      }
      svg('path', { d: path, fill: 'none', stroke: color, 'stroke-width': 2.5, 'stroke-linejoin': 'round' });
    }
    const eventItems = [];
    for (const sample of visible) {
      if (sample.manualReset) eventItems.push({ at: sample.at, kind: 'manual', label: '' });
      for (const key of ['fiveHour', 'weekly']) {
        const kind = sample.events?.[key];
        if (kind && kind !== 'manual') eventItems.push({ at: sample.at, kind, label: key === 'fiveHour' ? '5 小时' : '每周' });
      }
    }
    for (const item of eventItems) {
      const [icon, label, color] = kinds[item.kind];
      const marker = svg('text', { x: x(item.at), y: top - 10, 'text-anchor': 'middle', style: `fill:${color}` }, icon);
      const title = document.createElementNS(NS, 'title'); title.textContent = `${dateText(item.at)} ${item.label} ${label}`; marker.append(title);
    }
    svg('line', { id: 'hover-line', x1: left, x2: left, y1: top, y2: bottom, stroke: '#a7bad4', 'stroke-dasharray': '4 4', visibility: 'hidden' });
    events.replaceChildren();
    if (!eventItems.length) { const note = document.createElement('p'); note.className = 'muted'; note.textContent = '该时段暂无恢复记录'; events.append(note); }
    for (const item of eventItems.reverse()) {
      const row = document.createElement('div'); row.className = 'event';
      const icon = document.createElement('span'); icon.className = `icon ${item.kind}`; icon.textContent = kinds[item.kind][0];
      const time = document.createElement('time'); time.textContent = dateText(item.at);
      const label = document.createElement('span'); label.textContent = `${item.label} ${kinds[item.kind][1]}`.trim();
      row.append(icon, time, label); events.append(row);
    }
    document.getElementById('updated').textContent = history.samples.length ? `最近记录 ${dateText(history.samples.at(-1).at)}` : '';
    document.getElementById('error').textContent = history.error ?? '';
    document.getElementById('error').hidden = !history.error;
  }
  chart.addEventListener('pointermove', (event) => {
    if (!visible.length) return;
    const bounds = chart.getBoundingClientRect();
    const at = start + ((event.clientX - bounds.left) / bounds.width * 900 - left) / (right - left) * (end - start);
    const nearest = visible.reduce((best, sample) => Math.abs(sample.at - at) < Math.abs(best.at - at) ? sample : best);
    if (Math.abs(nearest.at - at) > 330000) { tooltip.hidden = true; document.getElementById('hover-line').setAttribute('visibility', 'hidden'); return; }
    const line = document.getElementById('hover-line');
    line.setAttribute('x1', x(nearest.at)); line.setAttribute('x2', x(nearest.at)); line.setAttribute('visibility', 'visible');
    const value = (key) => Number.isFinite(nearest[key]?.remainingPercent) ? `${Math.round(nearest[key].remainingPercent)}%` : '无记录';
    tooltip.textContent = `${dateText(nearest.at)}${hasFiveHour ? `\n5 小时剩余 ${value('fiveHour')}` : ''}\n每周剩余 ${value('weekly')}`;
    tooltip.hidden = false;
    tooltip.style.left = `${Math.max(0, Math.min(bounds.width - tooltip.offsetWidth, event.clientX - bounds.left + 12))}px`;
    tooltip.style.top = `${Math.max(0, event.clientY - bounds.top - tooltip.offsetHeight - 12)}px`;
  });
  chart.addEventListener('pointerleave', () => { tooltip.hidden = true; document.getElementById('hover-line')?.setAttribute('visibility', 'hidden'); });
  for (const button of document.querySelectorAll('[data-hours]')) button.addEventListener('click', () => {
    hours = Number(button.dataset.hours);
    for (const tab of document.querySelectorAll('[data-hours]')) tab.setAttribute('aria-pressed', String(tab === button));
    render();
  });
  const load = async () => {
    try { history = await window.quota.readHistory(); render(); }
    catch { document.getElementById('error').hidden = false; document.getElementById('error').textContent = '历史暂时无法读取，请重新打开趋势窗口。'; }
  };
  window.quota.subscribeHistory(load);
  setInterval(load, 60000);
  void load();
})();
