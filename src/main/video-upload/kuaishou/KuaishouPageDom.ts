import type {
  KuaishouFormState,
  KuaishouOption,
  KuaishouOptionField,
  KuaishouOptionsResult,
  KuaishouPageActionErrorCode,
  KuaishouPageCapabilities,
  KuaishouWebEditableField,
  KuaishouWebEditableFields
} from "../types";

export type KuaishouDomInspection = {
  capabilities: KuaishouPageCapabilities;
  fields: Partial<KuaishouWebEditableFields>;
  matchedKeys: string[];
};

export type KuaishouDomApplyResult = {
  ok: boolean;
  appliedFields: KuaishouWebEditableField[];
  errors: Array<{
    field: KuaishouWebEditableField;
    code: KuaishouPageActionErrorCode;
    message: string;
    requestedValue?: string;
    currentPageValue?: string;
    candidates?: KuaishouOption[];
  }>;
};

const helperSource = String.raw`
  const clean = (text) => String(text || "").replace(/\s+/g, " ").trim();
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const bodyText = () => clean(document.body?.innerText || document.body?.textContent || "");
  const visible = (el) => {
    if (!el) return false;
    if (el instanceof HTMLInputElement && el.type === "hidden") return false;
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };
  const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const textOf = (el) => clean(el?.value || el?.innerText || el?.textContent || el?.getAttribute?.("aria-label") || "");
  const clickElement = (el) => {
    const target = el?.closest?.("label,button,a,[role='button'],[role='switch']") || el;
    if (!target) return false;
    target.scrollIntoView?.({ block: "center", inline: "center" });
    target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }));
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    target.click();
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    target.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "mouse" }));
    return true;
  };
  const byText = (text, selector = "button,a,label,span,div,p") => {
    const wanted = clean(text);
    return all(selector)
      .filter((el) => visible(el) && textOf(el).includes(wanted))
      .sort((a, b) => {
        const aButton = a.closest("button") ? 0 : 1;
        const bButton = b.closest("button") ? 0 : 1;
        if (aButton !== bButton) return aButton - bButton;
        return textOf(a).length - textOf(b).length;
      })[0] || null;
  };
  const clickableByText = (text) => {
    const direct = byText(text, "button,a,label,[role='button'],[role='switch']");
    if (direct) return direct.closest("button,a,label,[role='button'],[role='switch']") || direct;
    const leaf = byText(text);
    return leaf?.closest("button,a,label,[role='button'],[role='switch']") || leaf || null;
  };
  const exactButtonByText = (text) => {
    const wanted = clean(text);
    const node = all("button,[role='button'],a,label,span,div")
      .filter((el) => visible(el) && textOf(el) === wanted)
      .sort((a, b) => textOf(a).length - textOf(b).length)[0] || null;
    return node?.closest("button,[role='button'],a,label") || node;
  };
  const sectionWithText = (text) => {
    const wanted = clean(text);
    return all("section,form,div")
      .filter((el) => visible(el) && clean(el.innerText || el.textContent).includes(wanted))
      .sort((a, b) => clean(a.innerText || a.textContent).length - clean(b.innerText || b.textContent).length)[0] || null;
  };
  const inputNearText = (text, index = 0) => {
    const anchor = byText(text, "label,span,div,p");
    let root = anchor;
    while (root && root !== document.body) {
      const inputs = Array.from(root.querySelectorAll("input[role='combobox'],input:not([type='checkbox']):not([type='radio']):not([type='file']),textarea"))
        .filter((el) => visible(el));
      if (inputs.length > index) return inputs[index];
      root = root.parentElement;
    }
    return null;
  };
  const inputByPlaceholder = (placeholder) => {
    const wanted = clean(placeholder);
    return all("input,textarea").filter((el) => visible(el) && clean(el.getAttribute("placeholder")).includes(wanted))[0] || inputNearText(wanted);
  };
  const selectedTextNearInput = (input) => {
    const root = input?.closest(".ant-select,.ant-picker,.ant-input-affix-wrapper,.ant-form-item,label,div");
    if (!root) return "";
    const selected = root.querySelector(".ant-select-selection-item,.ant-picker-input input");
    return clean(selected?.value || selected?.innerText || selected?.textContent || input.value || "");
  };
  const inputValue = (input, placeholderText = "") => {
    const value = clean(input?.value || selectedTextNearInput(input) || "");
    const placeholder = clean(placeholderText);
    return placeholder && value.includes(placeholder) ? "" : value;
  };
  const findCaptionEditor = () => {
    const editors = all("[contenteditable='true'],[contenteditable='plaintext-only'],textarea,input")
      .filter((el) => visible(el))
      .filter((el) => {
        const text = clean(el.getAttribute("placeholder") || "");
        const rootText = clean(el.closest("section,form,div,body")?.innerText || "");
        return text.includes("作品描述") || rootText.includes("作品描述");
      });
    return editors[0] || null;
  };
  const findPublishTimeInput = () => {
    const section = sectionWithText("发布时间") || document.body;
    return Array.from(section.querySelectorAll("input"))
      .filter((el) => visible(el) && el.type !== "radio" && el.type !== "checkbox")
      .filter((el) => {
        const placeholder = clean(el.getAttribute("placeholder"));
        const rootText = clean(el.closest("div,label")?.innerText || "");
        return placeholder.includes("时间") || placeholder.includes("日期") || rootText.includes("定时") || rootText.includes("发布时间");
      })[0] || null;
  };
  const readCheckbox = (name) => {
    const input = document.querySelector("input[name='" + name + "'],input[type='checkbox'][value='" + name + "']");
    return Boolean(input?.checked);
  };
  const findLabelInput = (labelText, type) => {
    const labels = all("label").filter((label) => visible(label) && clean(label.innerText || label.textContent).includes(labelText));
    for (const label of labels) {
      const input = label.querySelector("input" + (type ? "[type='" + type + "']" : ""));
      if (input) return input;
    }
    const textNode = byText(labelText, "span,div,p");
    return textNode?.closest("label")?.querySelector("input" + (type ? "[type='" + type + "']" : "")) || null;
  };
  const radioChecked = (labelText) => Boolean(findLabelInput(labelText, "radio")?.checked);
  const readVisibility = () => {
    if (radioChecked("好友可见")) return "friends";
    if (radioChecked("仅自己可见")) return "private";
    return "public";
  };
  const readPublishTimingMode = () => radioChecked("定时发布") ? "scheduled" : "immediate";
  const readSwitchNear = (labelText) => {
    const label = byText(labelText);
    const area = label?.closest("section,form,div") || document.body;
    const sw = area.querySelector("[role='switch'],button[aria-checked]");
    if (!sw) return undefined;
    const aria = sw.getAttribute("aria-checked");
    if (aria === "true") return true;
    if (aria === "false") return false;
    return /checked|active/i.test(sw.className || "");
  };
  const setInputValue = (el, value) => {
    if (!el) return false;
    el.focus();
    if (el.isContentEditable) {
      try {
        document.execCommand("selectAll", false);
        document.execCommand("insertText", false, String(value || ""));
      } catch {
        el.textContent = String(value || "");
      }
    } else if ("value" in el) {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, String(value || ""));
      else el.value = String(value || "");
    } else {
      el.textContent = String(value || "");
    }
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value || "") }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  };
  const clickControl = (el) => clickElement(el);
  const setCheckbox = (name, desired) => {
    const input = document.querySelector("input[name='" + name + "'],input[type='checkbox'][value='" + name + "']");
    if (!input) return false;
    if (Boolean(input.checked) !== Boolean(desired)) {
      clickControl(input);
      if (Boolean(input.checked) !== Boolean(desired)) {
        input.checked = Boolean(desired);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
    return true;
  };
  const clickRadio = (labelText) => {
    const input = findLabelInput(labelText, "radio");
    if (!input) return false;
    if (!input.checked) clickControl(input);
    return true;
  };
  const setSwitchNear = (labelText, desired) => {
    const current = readSwitchNear(labelText);
    const label = byText(labelText);
    const area = label?.closest("section,form,div") || document.body;
    const sw = area.querySelector("[role='switch'],button[aria-checked]");
    if (!sw) return false;
    if (current !== Boolean(desired)) clickControl(sw);
    return true;
  };
  const optionFieldConfig = {
    authorServiceType: { label: "作者服务", placeholder: "选择服务类型", inputIndex: 0 },
    linkedBenefit: { label: "作者服务", placeholder: "关联成功可获得更多收益", inputIndex: 0 },
    hotspot: { label: "关联热点", placeholder: "输入你想关联的热点", inputIndex: 0 },
    authorStatement: { label: "作者声明", placeholder: "为作品添加补充说明", inputIndex: 0 },
    collectionName: { label: "加入合集", placeholder: "选择要加入到的合集", inputIndex: 0 },
    locationRegion: { label: "添加地点", placeholder: "请选择所在地区", inputIndex: 0 },
    locationAddress: { label: "添加地点", placeholder: "请输入视频详细地址", inputIndex: 0, freeText: true }
  };
  const inputForOptionField = (field) => {
    const cfg = optionFieldConfig[field];
    if (!cfg) return null;
    const placeholderMatches = all("input[role='combobox'],input:not([type='checkbox']):not([type='radio']):not([type='file']),textarea")
      .filter((el) => visible(el) && clean(el.getAttribute("placeholder")).includes(cfg.placeholder));
    if (placeholderMatches.length > cfg.inputIndex) return placeholderMatches[cfg.inputIndex];
    if (placeholderMatches[0]) return placeholderMatches[0];
    return inputNearText(cfg.label, cfg.inputIndex);
  };
  const selectedValueForOptionField = (field) => {
    const cfg = optionFieldConfig[field];
    const input = inputForOptionField(field);
    return inputValue(input, cfg?.placeholder || "");
  };
  const readOptionCandidates = () => {
    const dropdowns = all(".ant-select-dropdown:not(.ant-select-dropdown-hidden),.ant-cascader-dropdown:not(.ant-cascader-dropdown-hidden)")
      .filter((el) => visible(el));
    const seen = new Set();
    const options = [];
    for (const dropdown of dropdowns) {
      const nodes = all(".ant-select-item-option:not(.ant-select-item-option-disabled),.ant-cascader-menu-item:not(.ant-cascader-menu-item-disabled),[role='option']", dropdown)
        .filter((el) => visible(el));
      for (const node of nodes) {
        const rawText = clean(node.innerText || node.textContent);
        const label = clean(node.getAttribute("label") || node.getAttribute("title") || rawText);
        const value = clean(node.getAttribute("value") || node.getAttribute("data-value") || node.getAttribute("title") || node.getAttribute("label") || label || rawText);
        const key = label + "::" + value + "::" + rawText;
        if (!rawText && !label) continue;
        if (seen.has(key)) continue;
        seen.add(key);
        options.push({ label: label || rawText, value: value || label || rawText, rawText });
      }
    }
    return options;
  };
  const openOptionDropdown = async (field, query = "") => {
    const input = inputForOptionField(field);
    if (!input) return { input: null, options: [] };
    const selectRoot = input.closest(".ant-select,.ant-cascader-picker,.ant-input-affix-wrapper,.ant-form-item") || input.parentElement || input;
    const clickable = selectRoot.querySelector(".ant-select-selector,.ant-cascader-picker-label,.ant-input") || input;
    clickElement(clickable);
    await wait(250);
    input.focus();
    if (input.getAttribute("role") === "combobox" || query) {
      setInputValue(input, query);
      input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: query.slice(-1) || "a" }));
      input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: query.slice(-1) || "a" }));
    }
    await wait(700);
    return { input, options: readOptionCandidates() };
  };
  const selectOptionByValue = async (field, requestedValue) => {
    const cfg = optionFieldConfig[field];
    const wanted = clean(requestedValue);
    const input = inputForOptionField(field);
    if (!input) {
      return { ok: false, code: "ELEMENT_NOT_FOUND", message: "当前页面没有找到“" + (cfg?.label || field) + "”控件。", candidates: [] };
    }
    if (!wanted) return { ok: true, currentPageValue: selectedValueForOptionField(field), candidates: [] };
    if (cfg?.freeText) {
      setInputValue(input, wanted);
      return { ok: true, currentPageValue: inputValue(input, cfg.placeholder), candidates: [] };
    }
    let opened = await openOptionDropdown(field, "");
    let options = opened.options;
    if (options.length === 0) {
      opened = await openOptionDropdown(field, wanted);
      options = opened.options;
    }
    const normalizedWanted = wanted.toLowerCase();
    const exactMatches = options.filter((option) =>
      clean(option.label).toLowerCase() === normalizedWanted ||
      clean(option.value).toLowerCase() === normalizedWanted ||
      clean(option.rawText).toLowerCase() === normalizedWanted
    );
    const containsMatches = options.filter((option) =>
      clean(option.label).toLowerCase().includes(normalizedWanted) ||
      clean(option.value).toLowerCase().includes(normalizedWanted) ||
      clean(option.rawText).toLowerCase().includes(normalizedWanted)
    );
    const match = exactMatches[0] || (containsMatches.length === 1 ? containsMatches[0] : null);
    if (!match) {
      return {
        ok: false,
        code: containsMatches.length > 1 ? "OPTION_AMBIGUOUS" : "OPTION_NOT_FOUND",
        message: containsMatches.length > 1
          ? "“" + wanted + "”匹配到多个候选，请从右侧候选中选择一个精确值。"
          : "没有找到“" + wanted + "”对应的页面候选。",
        candidates: options
      };
    }
    const optionNodes = all(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option:not(.ant-select-item-option-disabled),.ant-cascader-dropdown:not(.ant-cascader-dropdown-hidden) .ant-cascader-menu-item:not(.ant-cascader-menu-item-disabled),.ant-select-dropdown:not(.ant-select-dropdown-hidden) [role='option']")
      .filter((el) => visible(el));
    const node = optionNodes.find((el) => {
      const rawText = clean(el.innerText || el.textContent);
      const label = clean(el.getAttribute("label") || el.getAttribute("title") || rawText);
      const value = clean(el.getAttribute("value") || el.getAttribute("data-value") || el.getAttribute("title") || el.getAttribute("label") || label || rawText);
      return label === match.label && value === match.value && rawText === match.rawText;
    }) || optionNodes.find((el) => clean(el.innerText || el.textContent).includes(match.label));
    if (!node || !clickElement(node.querySelector(".ant-select-item-option-content,.ant-cascader-menu-item-content") || node)) {
      return { ok: false, code: "OPTION_NOT_FOUND", message: "候选存在但无法点击，请在左侧页面手动选择。", candidates: options };
    }
    await wait(500);
    return { ok: true, currentPageValue: selectedValueForOptionField(field) || match.label, candidates: options };
  };
  const parsePublishTime = (value) => {
    const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const parts = {
      year: Number(match[1]),
      month: Number(match[2]),
      day: Number(match[3]),
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: Number(match[6] || "00")
    };
    if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31 || parts.hour > 23 || parts.minute > 59 || parts.second > 59) return null;
    const pad = (n) => String(n).padStart(2, "0");
    return {
      ...parts,
      dateTitle: String(parts.year) + "-" + pad(parts.month) + "-" + pad(parts.day),
      minuteText: String(parts.year) + "-" + pad(parts.month) + "-" + pad(parts.day) + " " + pad(parts.hour) + ":" + pad(parts.minute),
      fullText: String(parts.year) + "-" + pad(parts.month) + "-" + pad(parts.day) + " " + pad(parts.hour) + ":" + pad(parts.minute) + ":" + pad(parts.second),
      hourText: pad(parts.hour),
      minuteOnlyText: pad(parts.minute),
      secondText: pad(parts.second)
    };
  };
  const readPickerYearMonth = () => {
    const dropdown = all(".ant-picker-dropdown").filter((el) => visible(el))[0];
    if (!dropdown) return null;
    const year = Number(clean(dropdown.querySelector(".ant-picker-year-btn")?.innerText).replace(/\D/g, ""));
    const month = Number(clean(dropdown.querySelector(".ant-picker-month-btn")?.innerText).replace(/\D/g, ""));
    if (!year || !month) return null;
    return { year, month };
  };
  const monthDiff = (from, to) => (to.year - from.year) * 12 + (to.month - from.month);
  const ensurePickerMonth = async (target) => {
    for (let index = 0; index < 36; index += 1) {
      const current = readPickerYearMonth();
      if (!current) return false;
      const diff = monthDiff(current, target);
      if (diff === 0) return true;
      const button = diff > 0
        ? all(".ant-picker-header-next-btn").filter((el) => visible(el))[0]
        : all(".ant-picker-header-prev-btn").filter((el) => visible(el))[0];
      if (!button) return false;
      clickElement(button);
      await wait(200);
    }
    return false;
  };
  const clickTimeValue = async (columnIndex, value) => {
    const columns = all(".ant-picker-time-panel-column").filter((el) => visible(el));
    const column = columns[columnIndex];
    if (!column) return false;
    const node = all("li,div", column)
      .filter((el) => visible(el) && textOf(el) === value)
      .sort((a, b) => textOf(a).length - textOf(b).length)[0];
    if (!node) return false;
    clickElement(node.querySelector(".ant-picker-time-panel-cell-inner") || node);
    await wait(150);
    return true;
  };
  const samePublishMinute = (actual, target) => clean(actual).slice(0, 16) === target.minuteText;
  const setScheduledTime = async (value) => {
    const target = parsePublishTime(value);
    if (!target) {
      return { ok: false, code: "TIME_WRITE_MISMATCH", message: "定时发布时间格式必须是 YYYY-MM-DD HH:mm。", requestedValue: clean(value), currentPageValue: "" };
    }
    if (!clickRadio("定时发布")) {
      return { ok: false, code: "ELEMENT_NOT_FOUND", message: "当前页面没有找到“定时发布”选项。", requestedValue: target.minuteText, currentPageValue: "" };
    }
    await wait(250);
    const input = findPublishTimeInput();
    if (!input) {
      return { ok: false, code: "TIME_PICKER_NOT_FOUND", message: "当前页面没有找到定时发布时间输入框。", requestedValue: target.minuteText, currentPageValue: "" };
    }
    clickElement(input);
    await wait(400);
    if (!all(".ant-picker-dropdown").some((el) => visible(el))) {
      clickElement(input.closest(".ant-picker") || input);
      await wait(400);
    }
    if (!all(".ant-picker-dropdown").some((el) => visible(el))) {
      return { ok: false, code: "TIME_PICKER_NOT_FOUND", message: "定时发布时间控件没有打开。", requestedValue: target.minuteText, currentPageValue: inputValue(input) };
    }
    if (!(await ensurePickerMonth(target))) {
      return { ok: false, code: "TIME_PICKER_NOT_FOUND", message: "无法切换到目标月份。", requestedValue: target.minuteText, currentPageValue: inputValue(input) };
    }
    const dateCell = all("td[title='" + target.dateTitle + "']")
      .filter((el) => visible(el) && !(el.className || "").includes("disabled"))[0];
    if (!dateCell) {
      return { ok: false, code: "TIME_PICKER_NOT_FOUND", message: "无法在日期控件中找到目标日期。", requestedValue: target.minuteText, currentPageValue: inputValue(input) };
    }
    clickElement(dateCell.querySelector(".ant-picker-cell-inner") || dateCell);
    await wait(250);
    const hourOk = await clickTimeValue(0, target.hourText);
    const minuteOk = await clickTimeValue(1, target.minuteOnlyText);
    const secondOk = await clickTimeValue(2, target.secondText);
    if (!hourOk || !minuteOk || !secondOk) {
      return { ok: false, code: "TIME_PICKER_NOT_FOUND", message: "无法在时间控件中选择目标时分秒。", requestedValue: target.minuteText, currentPageValue: inputValue(input) };
    }
    const okButton = all(".ant-picker-ok button").filter((el) => visible(el) && !el.disabled)[0] || exactButtonByText("确定");
    if (!okButton) {
      return { ok: false, code: "TIME_PICKER_NOT_FOUND", message: "定时发布时间控件没有找到确定按钮。", requestedValue: target.minuteText, currentPageValue: inputValue(input) };
    }
    clickElement(okButton);
    await wait(700);
    const currentValue = inputValue(input);
    if (!samePublishMinute(currentValue, target)) {
      return { ok: false, code: "TIME_WRITE_MISMATCH", message: "页面显示的定时时间和请求时间不一致。", requestedValue: target.minuteText, currentPageValue: currentValue };
    }
    return { ok: true, requestedValue: target.minuteText, currentPageValue: currentValue };
  };
`;

export function kuaishouInspectPageScript(): string {
  return `
    (() => {
      ${helperSource}
      const text = bodyText();
      const captionEditor = findCaptionEditor();
      const publishTimeInput = findPublishTimeInput();
      const hasPublishButton = Boolean(exactButtonByText("发布"));
      const fields = {
        caption: clean(captionEditor?.value || captionEditor?.innerText || captionEditor?.textContent || ""),
        pkCoverEnabled: readSwitchNear("PK封面"),
        chaptersText: "",
        authorServiceType: selectedValueForOptionField("authorServiceType"),
        linkedBenefit: selectedValueForOptionField("linkedBenefit"),
        hotspot: selectedValueForOptionField("hotspot"),
        authorStatement: selectedValueForOptionField("authorStatement"),
        collectionName: selectedValueForOptionField("collectionName"),
        locationRegion: selectedValueForOptionField("locationRegion"),
        locationAddress: selectedValueForOptionField("locationAddress"),
        allowSameFrame: readCheckbox("allowSameFrame"),
        allowDownload: readCheckbox("downloadType"),
        showInNearby: readCheckbox("disableNearbyShow"),
        visibility: readVisibility(),
        publishTimingMode: readPublishTimingMode(),
        scheduledPublishTime: inputValue(publishTimeInput),
        useBestTimeSuggestion: false
      };
      const capabilities = {
        hasEditableContent: false,
        hasDraftContinueButton: text.includes("还有上次未发布的视频") && Boolean(clickableByText("继续编辑")),
        hasCaptionEditor: Boolean(captionEditor),
        hasPublishTimeInput: Boolean(publishTimeInput),
        hasFileInput: Boolean(document.querySelector("input[type='file']")),
        hasUploadEntryButton: Boolean(clickableByText("上传视频") || clickableByText("发布视频")),
        hasCoverSettings: text.includes("封面设置"),
        hasPkCoverSwitch: readSwitchNear("PK封面") !== undefined,
        hasChapterButton: Boolean(clickableByText("添加章节")),
        hasAuthorServiceSelect: Boolean(inputForOptionField("authorServiceType")),
        hasBenefitSelect: Boolean(inputForOptionField("linkedBenefit")),
        hasHotspotInput: Boolean(inputForOptionField("hotspot")),
        hasAuthorStatementInput: Boolean(inputForOptionField("authorStatement")),
        hasCollectionSelect: Boolean(inputForOptionField("collectionName")),
        hasLocationRegionSelect: Boolean(inputForOptionField("locationRegion")),
        hasLocationAddressInput: Boolean(inputForOptionField("locationAddress")),
        hasInteractionSettings: Boolean(
          document.querySelector("input[name='allowSameFrame'],input[type='checkbox'][value='allowSameFrame']") ||
          document.querySelector("input[name='downloadType'],input[type='checkbox'][value='downloadType']") ||
          document.querySelector("input[name='disableNearbyShow'],input[type='checkbox'][value='disableNearbyShow']")
        ),
        hasVisibilitySettings: Boolean(findLabelInput("所有人可见", "radio") || findLabelInput("好友可见", "radio") || findLabelInput("仅自己可见", "radio")),
        hasPublishTimingSettings: Boolean(findLabelInput("立即发布", "radio") || findLabelInput("定时发布", "radio")),
        hasUploadProgress: text.includes("上传中") || text.includes("处理中"),
        hasUploadComplete: text.includes("视频上传成功") || text.includes("上传完成") || hasPublishButton,
        hasPublishButton,
        hasErrorToast: text.includes("失败") || text.includes("错误"),
        loginRequired: /login|passport/i.test(location.href) || ((text.includes("立即登录") || text.includes("扫码登录") || text.includes("请先登录")) && !captionEditor && !document.querySelector("input[type='file']"))
      };
      capabilities.hasEditableContent = Boolean(
        capabilities.hasCaptionEditor ||
        capabilities.hasPublishTimeInput ||
        capabilities.hasCollectionSelect ||
        capabilities.hasInteractionSettings ||
        capabilities.hasVisibilitySettings ||
        capabilities.hasPublishTimingSettings ||
        capabilities.hasPublishButton
      );
      const matchedKeys = Object.keys(capabilities).filter((key) => capabilities[key] === true);
      return { capabilities, fields, matchedKeys };
    })()
  `;
}

export function kuaishouReadOptionsScript(field: KuaishouOptionField, query = ""): string {
  return `
    (async () => {
      ${helperSource}
      const field = ${JSON.stringify(field)};
      const query = ${JSON.stringify(query)};
      const opened = await openOptionDropdown(field, "");
      const wanted = clean(query).toLowerCase();
      const options = wanted
        ? opened.options.filter((option) =>
            clean(option.label).toLowerCase().includes(wanted) ||
            clean(option.value).toLowerCase().includes(wanted) ||
            clean(option.rawText).toLowerCase().includes(wanted)
          )
        : opened.options;
      return {
        field,
        query,
        selectedValue: selectedValueForOptionField(field),
        options,
        readAt: Date.now()
      };
    })()
  `;
}

export function kuaishouApplyFieldsScript(state: KuaishouFormState, fields: KuaishouWebEditableField[]): string {
  return `
    (async () => {
      ${helperSource}
      const state = ${JSON.stringify(state)};
      const fields = ${JSON.stringify(fields)};
      const appliedFields = [];
      const errors = [];
      const addError = (field, code, message, extra = {}) => errors.push({ field, code, message, ...extra });
      const hasValue = (field) => state[field] !== undefined && state[field] !== null && String(state[field]).length > 0;
      const applyIfDirty = async (field, fn) => {
        if (!fields.includes(field)) return;
        const ok = await fn();
        if (ok) appliedFields.push(field);
      };

      await applyIfDirty("caption", async () => {
        const editor = findCaptionEditor();
        if (!editor) {
          addError("caption", "ELEMENT_NOT_FOUND", "当前页面没有找到“作品描述”输入框。");
          return false;
        }
        return setInputValue(editor, state.caption || "");
      });

      await applyIfDirty("pkCoverEnabled", async () => {
        const ok = setSwitchNear("PK封面", state.pkCoverEnabled);
        if (!ok) addError("pkCoverEnabled", "ELEMENT_NOT_FOUND", "当前页面没有找到“PK封面”开关。");
        return ok;
      });

      await applyIfDirty("chaptersText", async () => {
        if (!hasValue("chaptersText")) return true;
        addError("chaptersText", "MANUAL_ACTION_REQUIRED", "章节配置需要打开弹窗逐项设置，请在左侧页面手动完成。");
        return false;
      });

      for (const field of ["authorServiceType", "linkedBenefit", "hotspot", "authorStatement", "collectionName", "locationRegion", "locationAddress"]) {
        await applyIfDirty(field, async () => {
          if (!hasValue(field)) return true;
          const result = await selectOptionByValue(field, state[field]);
          if (!result.ok) {
            addError(field, result.code, result.message, {
              requestedValue: state[field],
              currentPageValue: selectedValueForOptionField(field),
              candidates: result.candidates || []
            });
            return false;
          }
          return true;
        });
      }

      await applyIfDirty("allowSameFrame", async () => {
        const ok = setCheckbox("allowSameFrame", state.allowSameFrame);
        if (!ok) addError("allowSameFrame", "ELEMENT_NOT_FOUND", "当前页面没有找到“允许别人跟我拍同框”。");
        return ok;
      });

      await applyIfDirty("allowDownload", async () => {
        const ok = setCheckbox("downloadType", state.allowDownload);
        if (!ok) addError("allowDownload", "ELEMENT_NOT_FOUND", "当前页面没有找到“允许下载此作品”。");
        return ok;
      });

      await applyIfDirty("showInNearby", async () => {
        const ok = setCheckbox("disableNearbyShow", state.showInNearby);
        if (!ok) addError("showInNearby", "ELEMENT_NOT_FOUND", "当前页面没有找到“作品展示在同城页”。");
        return ok;
      });

      await applyIfDirty("visibility", async () => {
        const label = state.visibility === "friends" ? "好友可见" : state.visibility === "private" ? "仅自己可见" : "所有人可见";
        const ok = clickRadio(label);
        if (!ok) addError("visibility", "ELEMENT_NOT_FOUND", "当前页面没有找到查看权限选项。");
        return ok;
      });

      await applyIfDirty("publishTimingMode", async () => {
        const ok = clickRadio(state.publishTimingMode === "scheduled" ? "定时发布" : "立即发布");
        if (!ok) addError("publishTimingMode", "ELEMENT_NOT_FOUND", "当前页面没有找到发布时间选项。");
        return ok;
      });

      await applyIfDirty("scheduledPublishTime", async () => {
        if (!hasValue("scheduledPublishTime")) return true;
        const result = await setScheduledTime(state.scheduledPublishTime);
        if (!result.ok) {
          addError("scheduledPublishTime", result.code, result.message, {
            requestedValue: result.requestedValue,
            currentPageValue: result.currentPageValue
          });
          return false;
        }
        return true;
      });

      await applyIfDirty("useBestTimeSuggestion", async () => {
        if (!state.useBestTimeSuggestion) return true;
        const button = clickableByText("一键设置");
        if (!button) {
          addError("useBestTimeSuggestion", "ELEMENT_NOT_FOUND", "当前页面没有找到“一键设置”按钮。");
          return false;
        }
        clickControl(button);
        return true;
      });

      return { ok: errors.length === 0, appliedFields, errors };
    })()
  `;
}
