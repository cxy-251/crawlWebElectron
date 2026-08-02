from __future__ import annotations

import asyncio
import json
import uuid
from typing import Any
from urllib.parse import quote

from safari_rpa.contracts.errors import ErrorKind, RpaError, UnknownSideEffectError
from safari_rpa.contracts.safari import Locator, PageCondition, PageRef, SafariAutomationPort


class BossPageAdapter:
    ORIGIN = "zhipin.com"
    START_URL = "https://www.zhipin.com/web/geek/jobs"

    def __init__(self, safari: SafariAutomationPort):
        self.safari = safari

    async def ensure_search_page(self) -> PageRef:
        page = await self.safari.ensure_site(self.ORIGIN, self.START_URL)
        await self.safari.wait_for(
            page,
            PageCondition.js(
                self._actionable_page_condition(),
                "Boss search/detail surface or an actionable blocking state appears",
            ),
            timeout=40,
        )
        await self.assert_access(page)
        return page

    async def ensure_page(self) -> PageRef:
        """Compatibility alias for callers that only need a search page."""

        return await self.ensure_search_page()

    async def open_detail_page(self, search_page: PageRef) -> PageRef:
        page = await self.safari.create_page(search_page, self.START_URL)
        await self.safari.wait_for(
            page,
            PageCondition.js(
                self._actionable_page_condition(),
                "Boss detail workspace surface or an actionable blocking state appears",
            ),
            timeout=40,
        )
        await self.assert_access(page)
        return page

    async def close_page(self, page: PageRef) -> None:
        await self.safari.close_page(page)

    async def assert_access(self, page: PageRef) -> dict[str, Any]:
        state = await self.safari.evaluate(
            page,
            self._access_state_script(),
        )
        if not isinstance(state, dict):
            raise RpaError("BOSS_PAGE_INVALID", "Boss page state is not readable")
        if state.get("risk"):
            raise RpaError("BOSS_RISK_CONTROL", "Boss requires manual risk-control verification", ErrorKind.BLOCKED_RISK, state)
        if state.get("login_required"):
            raise RpaError("BOSS_LOGIN_REQUIRED", "Boss login is required", ErrorKind.BLOCKED_AUTH, state)
        return state

    @staticmethod
    def _access_state_script() -> str:
        return r"""
            const text = document.body?.innerText || '';
            const url = location.href;
            const title = document.title || '';
            const parsedUrl = new URL(url);
            const loggedIn = !!document.querySelector('.nav-figure,.header-user,.user-nav,[class*=user-nav]');
            const list = !!document.querySelector('ul.rec-job-list a.job-name');
            const detail = !!document.querySelector('.job-sec-text,.job-detail,.job-detail-box');
            const empty = /暂无相关职位|没有找到相关职位|暂无职位|没有搜索结果/.test(text);
            const pageType = list && detail ? 'search_detail' : list ? 'search' : detail ? 'detail' :
                empty ? 'search_empty' : 'unknown';
            const riskPattern = /访问异常|账号异常|安全验证|操作频繁|暂时封禁|滑块验证|人机验证|请完成.{0,8}验证/;
            const visible = el => {
                if (!el) return false;
                const style = getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return style.display !== 'none' && style.visibility !== 'hidden' &&
                    rect.width > 0 && rect.height > 0;
            };
            const blockingSelectors = [
                '[role=dialog]',
                '.dialog-wrap',
                '.boss-dialog',
                '[class*=dialog]',
                '[class*=captcha]',
                '[class*=verify]',
                '[class*=security]',
                '[class*=safe]',
                '.geetest_panel',
                '.captcha'
            ].join(',');
            const loginPattern = /登录后继续|请登录|扫码登录|密码登录/;
            const loginSelectors = [
                '[role=dialog]',
                '.dialog-wrap',
                '.boss-dialog',
                '[class*=dialog]',
                '[class*=login]',
                '[class*=passport]',
                '.login-box',
                '.sign-wrap'
            ].join(',');
            const blockingNode = Array.from(document.querySelectorAll(blockingSelectors))
                .filter(visible)
                .find(el => riskPattern.test(el.innerText || ''));
            const visibleLoginNode = Array.from(document.querySelectorAll(loginSelectors))
                .filter(visible)
                .find(el => loginPattern.test(el.innerText || ''));
            const pageUnavailableRisk = riskPattern.test(text) && pageType === 'unknown';
            const loginUrl = /(^|\.)login\.zhipin\.com$/.test(parsedUrl.hostname) ||
                /\/(?:web\/user|login|passport)(?:[/?#]|$)/.test(parsedUrl.pathname);
            const pageUnavailableLogin = !loggedIn && pageType === 'unknown' && loginPattern.test(text);
            const loginRequired = loginUrl ||
                (!!visibleLoginNode && (!loggedIn || pageType === 'unknown')) ||
                pageUnavailableLogin;
            const loginReason = loginUrl ? 'login_url' :
                visibleLoginNode && (!loggedIn || pageType === 'unknown') ? 'visible_login_node' :
                pageUnavailableLogin ? 'unavailable_page_text' : '';
            const loginText = (visibleLoginNode?.innerText || (pageUnavailableLogin ? text : '')).trim().slice(0, 240);
            const path403 = /(?:^|\/)403(?:[./?]|$)/.test(parsedUrl.pathname);
            const title403 = /403\s*(Forbidden|错误|拒绝访问)/i.test(title);
            const risk = !!blockingNode || pageUnavailableRisk || path403 || title403;
            const riskReason = blockingNode ? 'visible_blocking_node' :
                pageUnavailableRisk ? 'unavailable_page_text' :
                path403 ? 'url_403' :
                title403 ? 'title_403' : '';
            const riskText = (blockingNode?.innerText || (pageUnavailableRisk ? text : '')).trim().slice(0, 240);
            return {risk, login_required: loginRequired, logged_in: loggedIn,
                page_type: pageType, has_list:list, has_detail:detail, empty, url,
                risk_reason: riskReason, risk_text: riskText, login_reason: loginReason, login_text: loginText};
            """

    async def open_search(self, page: PageRef, url: str) -> list[dict[str, Any]]:
        await self.safari.navigate(page, url)
        await self.safari.wait_for(
            page,
            PageCondition.js(
                self._search_page_condition(),
                "Boss search result or an actionable blocking state appears",
            ),
            timeout=35,
        )
        state = await self.assert_access(page)
        if state.get("page_type") not in {"search", "search_detail", "search_empty"}:
            raise RpaError("BOSS_SEARCH_PAGE_INVALID", "Boss did not expose a search result surface", details=state)
        for _ in range(5):
            await self.safari.evaluate(
                page,
                r"""
                const cards = document.querySelectorAll('.job-card-wrapper, .job-card-box, li.job-card');
                if (cards.length > 0) {
                    cards[cards.length - 1].scrollIntoView({block: "end"});
                }
                window.scrollBy(0, 2000);
                """
            )
            await asyncio.sleep(0.8)

        return await self._extract_search_jobs(page)

    async def next_page(self, page: PageRef) -> list[dict[str, Any]]:
        # Infinite scroll (waterfall) mode: just scroll down repeatedly
        for _ in range(6):
            await self.safari.evaluate(
                page,
                r"""
                const cards = document.querySelectorAll('.job-card-wrapper, .job-card-box, li.job-card');
                if (cards.length > 0) {
                    cards[cards.length - 1].scrollIntoView({block: "end"});
                }
                window.scrollBy(0, 2000);
                """
            )
            await asyncio.sleep(1.0)

        return await self._extract_search_jobs(page)

    async def _extract_search_jobs(self, page: PageRef) -> list[dict[str, Any]]:
        value = await self.safari.evaluate(
            page,
            r"""
            /* boss_extract_search_jobs */
            const records = new Map();
            const textValue = value => value == null ? '' : String(value).trim();
            const jobIdOf = item => textValue(
                item?.encryptJobId || item?.jobId || item?.encryptId || item?.job_id
            );
            const merge = item => {
                const jobId = jobIdOf(item);
                if (!jobId) return;
                const previous = records.get(jobId) || {};
                const compact = Object.fromEntries(
                    Object.entries(item).filter(([, value]) => value !== '' && value !== null && value !== undefined)
                );
                records.set(jobId, {...previous, ...compact, job_id: jobId});
            };
            const vueJobLists = [];
            const visited = new Set();
            const inspectVm = (vm, depth = 0) => {
                if (!vm || typeof vm !== 'object' || visited.has(vm) || depth > 4) return;
                visited.add(vm);
                for (const owner of [vm, vm.$data, vm.data, vm.jobData, vm.zpData]) {
                    if (!owner || typeof owner !== 'object') continue;
                    for (const key of ['jobList', 'list', 'jobs']) {
                        if (Array.isArray(owner[key]) && owner[key].some(jobIdOf)) {
                            vueJobLists.push(owner[key]);
                        }
                    }
                }
                for (const child of Array.isArray(vm.$children) ? vm.$children : []) {
                    inspectVm(child, depth + 1);
                }
                if (depth < 2) inspectVm(vm.$parent, depth + 1);
            };
            const candidateNodes = new Set();
            for (const selector of [
                '#wrap', '.page-job-wrapper', '.page-jobs-main', '.job-list-wrapper',
                '.job-list-box', 'ul.rec-job-list'
            ]) {
                for (const node of document.querySelectorAll(selector)) {
                    candidateNodes.add(node);
                    if (node.parentElement) candidateNodes.add(node.parentElement);
                }
            }
            for (const node of candidateNodes) inspectVm(node.__vue__);
            for (const list of vueJobLists) {
                for (const item of list) {
                    const jobId = jobIdOf(item);
                    if (!jobId) continue;
                    const city = textValue(item.cityName);
                    const district = textValue(item.areaDistrict || item.districtName);
                    const business = textValue(item.businessDistrict);
                    merge({
                        job_id: jobId,
                        title: textValue(item.jobName || item.title),
                        url: `${location.origin}/job_detail/${jobId}.html`,
                        salary: textValue(item.salaryDesc || item.salary),
                        company: textValue(item.brandName || item.companyName),
                        experience: textValue(item.jobExperience || item.experienceName || item.jobExperienceName),
                        education: textValue(item.jobDegree || item.degreeName || item.jobDegreeName),
                        scale: textValue(item.brandScaleName || item.scaleName),
                        location: textValue(item.jobArea || `${city}${district}${business}`),
                        security_id: textValue(item.securityId),
                        lid: textValue(item.lid),
                        friend_status: item.friendStatus,
                        can_add_friend: item.canAddFriend,
                        boss_online: item.bossOnline,
                        gold_hunter: item.goldHunter,
                        proxy_job: item.proxyJob,
                        job_valid_status: item.jobValidStatus
                    });
                }
            }
            const anchors = Array.from(document.querySelectorAll('.job-card-wrapper a[href*="/job_detail/"],.job-card-box a[href*="/job_detail/"],a.job-name[href*="/job_detail/"]'));
            const seen = new Set();
            for (const anchor of anchors) {
                const parsed = new URL(anchor.getAttribute('href') || anchor.href, location.origin);
                const match = parsed.pathname.match(/\/job_detail\/([^/?]+)\.html$/);
                if (!match || seen.has(match[1])) continue;
                seen.add(match[1]);
                const href = `${parsed.origin}/job_detail/${match[1]}.html`;
                const card = anchor.closest('.job-card-wrapper,.job-card-box,li') || anchor;
                const cardText = (card.innerText || '').replace(/\s+/g, ' ').trim();
                const pick = selectors => {
                    for (const selector of selectors) {
                        const value = card.querySelector(selector)?.innerText?.trim();
                        if (value) return value;
                    }
                    return '';
                };
                const title = (card.querySelector('.job-name,.job-title')?.innerText || anchor.innerText || '').split('\n')[0].trim();
                const salary = pick(['.salary','.job-salary','.red']);
                const company = pick(['.company-name','.company-info .name','.company-text']);
                const experience = (cardText.match(/经验不限|在校\/应届|应届生|\d+年以内|\d+-\d+年/)||[])[0] || '';
                const education = (cardText.match(/学历不限|初中|中专|高中|大专|本科|硕士|博士/)||[])[0] || '';
                const scale = (cardText.match(/少于\d+人|\d+-\d+人|\d+人以上|\d+万以上人/)||[])[0] || '';
                const locationText = pick(['.job-area','.job-location','.job-address','.job-area-wrapper']);
                merge({
                    job_id: match[1], title, url: href, salary, company, experience,
                    education, scale, location: locationText,
                    security_id: parsed.searchParams.get('securityId') || '',
                    lid: parsed.searchParams.get('lid') || ''
                });
            }
            return Array.from(records.values());
            """,
        )
        if not isinstance(value, list):
            return []
        jobs: list[dict[str, Any]] = []
        for item in value:
            if not isinstance(item, dict) or not item.get("url"):
                continue
            jobs.append({
                "job_id": str(item.get("job_id") or ""),
                "title": str(item.get("title") or ""),
                "url": str(item.get("url") or ""),
                "salary": str(item.get("salary") or ""),
                "company": str(item.get("company") or ""),
                "experience": str(item.get("experience") or ""),
                "education": str(item.get("education") or ""),
                "scale": str(item.get("scale") or ""),
                "location": str(item.get("location") or ""),
                "security_id": str(item.get("security_id") or ""),
                "lid": str(item.get("lid") or ""),
                "friend_status": item.get("friend_status"),
                "can_add_friend": item.get("can_add_friend"),
                "boss_online": item.get("boss_online"),
                "gold_hunter": item.get("gold_hunter"),
                "proxy_job": item.get("proxy_job"),
                "job_valid_status": item.get("job_valid_status"),
            })
        return jobs

    async def read_job_card(
        self,
        page: PageRef,
        listed: dict[str, Any],
        *,
        timeout: float = 15,
    ) -> dict[str, Any]:
        """Read a sanitized job card through Boss's authenticated same-origin GET."""

        await self.assert_access(page)
        security_id = str(listed.get("security_id") or "").strip()
        lid = str(listed.get("lid") or "").strip()
        job_id = str(listed.get("job_id") or "").strip()
        if not security_id or not lid or not job_id:
            raise RpaError(
                "BOSS_JOB_CARD_IDENTIFIERS_MISSING",
                "Boss search result does not expose securityId, lid, and job ID",
                ErrorKind.RETRYABLE,
                {"job_id": job_id, "has_security_id": bool(security_id), "has_lid": bool(lid)},
            )

        request_key = f"boss_job_card_{uuid.uuid4().hex}"
        endpoint = (
            "/wapi/zpgeek/job/card.json?"
            f"securityId={self._url_component(security_id)}&lid={self._url_component(lid)}"
        )
        key_json = json.dumps(request_key)
        endpoint_json = json.dumps(endpoint)
        started = await self.safari.evaluate(
            page,
            f"""
            /* boss_start_job_card_read */
            const key={key_json};
            const endpoint={endpoint_json};
            const slots=window.__safariRpaBossJobCards ||= Object.create(null);
            slots[key]={{state:'pending'}};
            const storeError = error => {{
                slots[key]={{state:'error',error:String(error).slice(0,240)}};
            }};
            const storePayload = (payload, status) => {{
                if (status < 200 || status >= 300) throw new Error(`HTTP ${{status}}`);
                if (payload?.code !== undefined && Number(payload.code) !== 0) {{
                    throw new Error(`provider code ${{payload.code}}`);
                }}
                const card=payload?.zpData?.jobCard || payload?.zpData?.card || payload?.zpData;
                if (!card || typeof card !== 'object') throw new Error('jobCard missing');
                const value = input => input == null ? '' : String(input).trim();
                const onlineValue = card.online ?? card.bossOnline;
                const online = onlineValue === true || onlineValue === 1;
                const active = value(card.activeTimeDesc || card.bossActiveTimeDesc) || (online ? '当前在线' : '');
                const bossName = value(card.bossName);
                const bossTitle = value(card.bossTitle);
                const bossRaw = [bossName, bossTitle, active].filter(Boolean).join(' ');
                slots[key]={{
                    state:'done',
                    value:{{
                        job_id:value(card.encryptJobId || card.jobId) || {json.dumps(job_id)},
                        title:value(card.jobName),
                        salary:value(card.salaryDesc),
                        company:value(card.brandName),
                        experience:value(card.experienceName || card.jobExperience),
                        education:value(card.degreeName || card.jobDegree),
                        location:value(card.address || card.jobAddress || card.cityName),
                        jd:value(card.postDescription || card.jobDescription),
                        hr_active_time:active,
                        hr_title:bossTitle,
                        hr_boss_raw:bossRaw,
                        friend_status:card.friendStatus,
                        can_add_friend:card.canAddFriend,
                        boss_online:onlineValue,
                        proxy_job:card.atsProxyJob,
                        job_valid_status:card.jobValidStatus
                    }}
                }};
            }};
            const request = new XMLHttpRequest();
            request.open('GET', new URL(endpoint, location.origin).href, true);
            request.withCredentials = true;
            request.timeout = 10000;
            request.setRequestHeader('Accept', 'application/json, text/plain, */*');
            request.onload = () => {{
                try {{
                    storePayload(JSON.parse(request.responseText || '{{}}'), request.status);
                }} catch (error) {{
                    storeError(error);
                }}
            }};
            request.onerror = () => storeError(`XHR network error status=${{request.status}}`);
            request.ontimeout = () => storeError('XHR timeout');
            try {{
                request.send();
            }} catch (error) {{
                storeError(error);
            }}
            return true;
            """,
        )
        if started is not True:
            raise RpaError(
                "BOSS_JOB_CARD_START_FAILED",
                "Boss background job-card read did not start",
                ErrorKind.RETRYABLE,
                {"job_id": job_id},
            )

        slot: object = None
        try:
            await self.safari.wait_for(
                page,
                PageCondition.js(
                    f"""
                    const slot=window.__safariRpaBossJobCards?.[{key_json}];
                    return slot?.state === 'done' || slot?.state === 'error';
                    """,
                    f"Boss background job card {job_id} completes",
                ),
                timeout=timeout,
            )
            slot = await self.safari.evaluate(
                page,
                f"""
                /* boss_take_job_card_read */
                const key={key_json};
                const slots=window.__safariRpaBossJobCards;
                const slot=slots?.[key] || null;
                if (slots) {{
                    delete slots[key];
                    if (Object.keys(slots).length === 0) delete window.__safariRpaBossJobCards;
                }}
                return slot;
                """,
            )
        finally:
            try:
                await self.safari.evaluate(
                    page,
                    f"""
                    /* boss_cleanup_job_card_read */
                    const key={key_json};
                    const slots=window.__safariRpaBossJobCards;
                    if (slots) {{
                        delete slots[key];
                        if (Object.keys(slots).length === 0) delete window.__safariRpaBossJobCards;
                    }}
                    return true;
                    """,
                )
            except Exception:
                pass

        if not isinstance(slot, dict):
            raise RpaError(
                "BOSS_JOB_CARD_INVALID",
                "Boss background job-card result is not readable",
                ErrorKind.RETRYABLE,
                {"job_id": job_id},
            )
        if slot.get("state") != "done" or not isinstance(slot.get("value"), dict):
            raise RpaError(
                "BOSS_JOB_CARD_FAILED",
                "Boss background job-card request failed",
                ErrorKind.RETRYABLE,
                {"job_id": job_id, "error": str(slot.get("error") or "")[:240]},
            )

        card = dict(listed)
        card.update({key: value for key, value in slot["value"].items() if value not in {"", None}})
        card["job_id"] = job_id
        card["url"] = str(listed.get("url") or "")
        card["source"] = "job_card_api"
        return card

    @staticmethod
    def _url_component(value: str) -> str:
        return quote(value, safe="")

    async def read_job(self, page: PageRef, url: str) -> dict[str, Any]:
        await self.safari.navigate(page, url)
        await self.safari.wait_for(
            page,
            PageCondition.js(
                """
                const text=document.body?.innerText||'';
                return !!document.querySelector('.job-sec-text,.job-detail,.job-detail-box') ||
                    /职位不存在|验证码|访问异常|登录/.test(text);
                """,
                "Boss job detail or an actionable blocking state appears",
            ),
            timeout=35,
        )
        await self.assert_access(page)
        value = await self.safari.evaluate(
            page,
            r"""
            const text = selector => document.querySelector(selector)?.innerText?.trim() || '';
            const title = text('.job-name') || text('h1') || document.title.split(/[-_]/)[0].replace(/招聘/g,'').trim();
            const salary = text('.salary') || text('.job-salary');
            const primary = text('.info-primary');
            const tagTexts = Array.from(document.querySelectorAll('.info-primary .tag-list li,.info-primary .tag-inlines,.job-info .text-desc')).map(el=>el.innerText.trim());
            const experience = tagTexts.find(value => /经验|应届|年以内|\d+-\d+年/.test(value)) || (primary.match(/经验不限|在校\/应届|应届生|\d+年以内|\d+-\d+年/)||[])[0] || '';
            const education = tagTexts.find(value => /学历不限|初中|中专|高中|大专|本科|硕士|博士/.test(value)) || (primary.match(/学历不限|初中|中专|高中|大专|本科|硕士|博士/)||[])[0] || '';
            const locationText = text('.location-address') || text('.job-location') || (primary.split('\n').find(value => /区|市|省/.test(value)) || '');
            const companyBox = document.querySelector('.sider-company,.company-info,.job-detail-company');
            const company = companyBox?.querySelector('.company-name,a')?.innerText?.trim() || document.title.split('_')[1]?.replace(/招聘.*$/,'').trim() || '';
            const companyText = companyBox?.innerText || '';
            const scale = (companyText.match(/少于\d+人|\d+-\d+人|\d+人以上|\d+万以上人/)||[])[0] || '';
            const jd = text('.job-sec-text') || text('.job-detail-section') || text('.job-detail-box');
            const jobId = (location.href.match(/job_detail\/([^.?/]+)/)||[])[1] || location.href;
            const bossActiveEl = document.querySelector('.boss-active-time');
            const bossText = bossActiveEl?.innerText?.trim() || document.querySelector('.job-boss-info,.detail-boss,.boss-info-wrap')?.innerText || '';
            const activePattern = /(刚刚在线|今日在线|今日活跃|刚刚活跃|当前在线|在线|近?[一二三四五六七1-7]日内?(?:活跃)?|近三日活跃|本周活跃|两周内活跃|本月活跃|近?\d+个?月内?活跃|半年前活跃|半年内活跃|近半年活跃|半年前)/;
            const activeMatch = bossText.match(activePattern);
            const hrActiveTime = activeMatch ? activeMatch[1] : '';
            const hrTitle = document.querySelector('.boss-title,.name-box .title,.boss-info-attr,.job-boss-info .title')?.innerText || '';
            return {job_id:jobId,url:location.href,title,salary,experience,education,location:locationText,company,scale,jd,hr_active_time:hrActiveTime,hr_title:hrTitle,hr_boss_raw:bossText};
            """,
        )
        if not isinstance(value, dict) or not value.get("job_id"):
            raise RpaError("BOSS_JOB_INVALID", "Boss job detail could not be extracted")
        return value

    async def page_metrics(self, page: PageRef) -> dict[str, Any]:
        value = await self.safari.evaluate(
            page,
            r"""
            return {
                url: location.href,
                dom_nodes: document.getElementsByTagName('*').length,
                job_cards: document.querySelectorAll('.job-card-wrapper,.job-card-box,li.job-card').length,
                images: document.images.length,
                scroll_height: Math.max(document.body?.scrollHeight||0,document.documentElement?.scrollHeight||0),
                background_job_card_slots: Object.keys(window.__safariRpaBossJobCards || {}).length
            };
            """,
        )
        return value if isinstance(value, dict) else {}

    async def communication_state(self, page: PageRef, expected_job_id: str) -> dict[str, Any]:
        value = await self.safari.evaluate(
            page,
            f"""
            const expected={expected_job_id!r};
            const current=(location.pathname.match(/job_detail[/]([^.?/]+)/)||[])[1]||'';
            const buttons = Array.from(document.querySelectorAll('button,a,[role=button]'));
            const button = document.querySelector('.btn-startchat,.op-btn-chat') || buttons.find(el => /立即沟通|继续沟通|已沟通/.test(el.innerText||''));
            const text = button?.innerText?.trim() || '';
            const status=/继续沟通|已沟通|发消息/.test(text)?'communicated':
                /立即沟通/.test(text)?'available':'unavailable';
            return {{job_id:current,expected_job_id:expected,same_job:current===expected,status,
                button_text:text,url:location.href}};
            """,
        )
        if not isinstance(value, dict):
            raise RpaError("BOSS_COMMUNICATION_STATE_INVALID", "Boss communication state is not readable")
        if not value.get("same_job"):
            raise RpaError(
                "BOSS_JOB_CONTEXT_MISMATCH",
                "Boss communication page does not match the expected job",
                details=value,
            )
        return value

    async def communicate(self, page: PageRef, expected_job_id: str) -> dict[str, Any]:
        existing = await self.communication_state(page, expected_job_id)
        if existing.get("status") == "communicated":
            return {**existing, "confirmed": True, "performed": False, "preexisting": True}
        if existing.get("status") != "available":
            raise RpaError("BOSS_COMMUNICATE_UNAVAILABLE", "Boss communicate control is unavailable", details=existing)
        candidates = [
            Locator.css(".btn-startchat,.op-btn-chat"),
            Locator.text("立即沟通"),
        ]
        target = None
        for locator in candidates:
            state = await self.safari.query(page, locator)
            if state.found and state.visible and state.enabled and "立即沟通" in state.text:
                target = locator
                break
        if target is None:
            raise RpaError("BOSS_COMMUNICATE_UNAVAILABLE", "No interactable communicate button was found")
        await self.safari.click(
            page,
            target,
            PageCondition.js(
                f"""
                const expected={expected_job_id!r};
                const current=(location.pathname.match(/job_detail[/]([^.?/]+)/)||[])[1]||'';
                const text=document.body?.innerText||'';
                const button=document.querySelector('.btn-startchat,.op-btn-chat');
                return current===expected&&(/继续沟通|已沟通|发消息/.test(button?.innerText||'')||/留在此页|工作经历不匹配/.test(text));
                """,
                f"Boss job {expected_job_id} changes communication state or presents its stay-on-page dialog",
            ),
            timeout=12,
        )

        mismatch = await self._experience_mismatch_state(page, expected_job_id)
        if mismatch.get("visible"):
            # Boss Zhipin's experience mismatch dialog often doesn't have a cancel button.
            # We can simply return the skipped state; the next job iteration will navigate away,
            # implicitly destroying the dialog.
            return {
                **mismatch,
                "status": "unavailable",
                "confirmed": False,
                "performed": False,
                "preexisting": False,
                "outcome": "skipped_experience_mismatch",
                "reason": "experience_mismatch",
            }

        confirmed = await self.communication_state(page, expected_job_id)
        if confirmed.get("status") != "communicated":
            raise UnknownSideEffectError(
                "Boss communication click was issued but success is not observable for the expected job",
                confirmed,
            )
        return {**confirmed, "confirmed": True, "performed": True, "preexisting": False}

    async def _experience_mismatch_state(self, page: PageRef, expected_job_id: str) -> dict[str, Any]:
        value = await self.safari.evaluate(
            page,
            f"""
            /* boss_experience_mismatch_state */
            const expected={expected_job_id!r};
            const current=(location.pathname.match(/job_detail[/]([^.?/]+)/)||[])[1]||'';
            const visible=el=>{{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;}};
            const dialogs=Array.from(document.querySelectorAll('[role=dialog],.dialog-wrap,.boss-dialog,.dialog-container,.greet-boss-dialog')).filter(visible);
            const dialog=dialogs.find(el=>/工作经历不匹配/.test(el.innerText||'') && (el.innerText||'').length < 500);
            return {{visible:!!dialog,same_job:current===expected,job_id:current,
                text:(dialog?.innerText||'').trim().slice(0,240),url:location.href}};
            """,
        )
        return value if isinstance(value, dict) else {"visible": False}



    async def reconcile_communication(self, page: PageRef, expected_job_id: str) -> dict[str, Any] | None:
        state = await self.communication_state(page, expected_job_id)
        if state.get("status") != "communicated":
            return None
        return {**state, "confirmed": True, "performed": True, "preexisting": False, "reconciled": True}

    @staticmethod
    def _actionable_page_condition() -> str:
        return """
            const text=document.body?.innerText||'';
            return !!document.querySelector('ul.rec-job-list a.job-name,.job-sec-text,.job-detail,.job-detail-box,#header,.header-user,.user-nav,[class*=user-nav]') ||
                /暂无相关职位|没有找到相关职位|暂无职位|验证码|访问异常|安全验证|登录/.test(text);
        """

    @staticmethod
    def _search_page_condition() -> str:
        return """
            const text=document.body?.innerText||'';
            return !!document.querySelector('ul.rec-job-list a.job-name') ||
                /暂无相关职位|没有找到相关职位|暂无职位|没有搜索结果|验证码|访问异常|安全验证|登录/.test(text);
        """
