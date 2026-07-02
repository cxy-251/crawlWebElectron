from __future__ import annotations

from typing import Any

from safari_rpa.contracts.errors import ErrorKind, RpaError, UnknownSideEffectError
from safari_rpa.contracts.safari import Locator, PageCondition, PageRef, SafariAutomationPort


class BossPageAdapter:
    ORIGIN = "zhipin.com"
    START_URL = "https://www.zhipin.com/web/geek/jobs"

    def __init__(self, safari: SafariAutomationPort):
        self.safari = safari

    async def ensure_page(self) -> PageRef:
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
            const riskPattern = /验证码|访问异常|账号异常|安全验证|操作频繁|暂时封禁/;
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
            const loginRequired = loginUrl || (!loggedIn && (!!visibleLoginNode || pageUnavailableLogin));
            const loginReason = loginUrl ? 'login_url' :
                !loggedIn && visibleLoginNode ? 'visible_login_node' :
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

    async def open_search(self, page: PageRef, url: str) -> list[dict[str, str]]:
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
        value = await self.safari.evaluate(
            page,
            r"""
            const list = document.querySelector('ul.rec-job-list');
            if (!list) return [];
            const anchors = Array.from(list.querySelectorAll('a.job-name[href*="/job_detail/"]'));
            const seen = new Set();
            return anchors.map(anchor => {
                const parsed = new URL(anchor.getAttribute('href') || anchor.href, location.origin);
                const match = parsed.pathname.match(/\/job_detail\/([^/?]+)\.html$/);
                if (!match || seen.has(match[1])) return null;
                seen.add(match[1]);
                const href = `${parsed.origin}/job_detail/${match[1]}.html`;
                const card = anchor.closest('li.job-card-box') || anchor;
                const title = (card.querySelector('.job-name,.job-title')?.innerText || anchor.innerText || '').split('\n')[0].trim();
                const cardText = card.innerText || '';
                const activeTimeMatch = cardText.match(/(刚刚活跃|今日活跃|当前在线|\d+日内活跃|本周活跃|本月活跃|\d+个月内活跃|近半年活跃|半年前活跃)/);
                const hrActiveTime = activeTimeMatch ? activeTimeMatch[1] : '';
                
                // 在提取链接的阶段直接过滤掉活跃时间超过一周的
                if (/(本月|月内|半年|年前)/.test(hrActiveTime)) {
                    return null;
                }
                
                return {job_id:match[1],title,url:href,hr_active_time:hrActiveTime};
            }).filter(Boolean);
            """,
        )
        if not isinstance(value, list):
            return []
        return [
            {
                "job_id": str(item.get("job_id") or ""),
                "title": str(item.get("title") or ""),
                "url": str(item.get("url") or ""),
                "hr_active_time": str(item.get("hr_active_time") or ""),
            }
            for item in value
            if isinstance(item, dict) and item.get("url")
        ]

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
            return {job_id:jobId,url:location.href,title,salary,experience,education,location:locationText,company,scale,jd};
            """,
        )
        if not isinstance(value, dict) or not value.get("job_id"):
            raise RpaError("BOSS_JOB_INVALID", "Boss job detail could not be extracted")
        return value

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
                /立即沟通|沟通/.test(text)?'available':'unavailable';
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
            Locator.text("沟通"),
        ]
        target = None
        for locator in candidates:
            state = await self.safari.query(page, locator)
            if state.found and state.visible and state.enabled:
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
            cancel = self._experience_mismatch_cancel_locator()
            cancel_state = await self.safari.query(page, cancel)
            if not (cancel_state.found and cancel_state.visible and cancel_state.enabled):
                raise UnknownSideEffectError(
                    "Boss experience-mismatch dialog appeared but its cancel control is unavailable",
                    mismatch,
                )
            await self.safari.click(
                page,
                cancel,
                PageCondition.js(
                    self._experience_mismatch_closed_condition(expected_job_id),
                    f"Boss mismatch dialog for job {expected_job_id} is closed without communication",
                ),
                timeout=8,
            )
            after_cancel = await self.communication_state(page, expected_job_id)
            if after_cancel.get("status") != "available":
                raise UnknownSideEffectError(
                    "Boss mismatch dialog closed but the expected job did not return to available state",
                    after_cancel,
                )
            return {
                **after_cancel,
                "confirmed": False,
                "performed": False,
                "preexisting": False,
                "outcome": "skipped_experience_mismatch",
                "reason": "experience_mismatch",
            }

        stay = Locator.text("留在此页")
        stay_state = await self.safari.query(page, stay)
        if stay_state.found and stay_state.visible and stay_state.enabled:
            await self.safari.click(
                page,
                stay,
                PageCondition.absent(stay, "Boss stay-on-page dialog closes"),
                timeout=8,
            )
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
            const dialogs=Array.from(document.querySelectorAll('[role=dialog],.dialog-wrap,.boss-dialog,[class*=dialog]')).filter(visible);
            const dialog=dialogs.find(el=>/工作经历不匹配/.test(el.innerText||''));
            return {{visible:!!dialog,same_job:current===expected,job_id:current,
                text:(dialog?.innerText||'').trim().slice(0,240),url:location.href}};
            """,
        )
        return value if isinstance(value, dict) else {"visible": False}

    @staticmethod
    def _experience_mismatch_cancel_locator() -> Locator:
        return Locator.script(
            "(()=>{const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();"
            "return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0};"
            "const dialog=Array.from(document.querySelectorAll('[role=dialog],.dialog-wrap,.boss-dialog,[class*=dialog]'))"
            ".filter(visible).find(el=>/工作经历不匹配/.test(el.innerText||''));if(!dialog)return null;"
            "const controls=Array.from(dialog.querySelectorAll('button,[role=button],a')).filter(visible);"
            "return controls.find(el=>/^(取消|暂不沟通|再看看|关闭)$/.test((el.innerText||el.getAttribute('aria-label')||'').trim()))||"
            "controls.find(el=>/关闭|close/i.test(el.getAttribute('aria-label')||''))||null;})()"
        )

    @staticmethod
    def _experience_mismatch_closed_condition(expected_job_id: str) -> str:
        return f"""
            const expected={expected_job_id!r};
            const current=(location.pathname.match(/job_detail[/]([^.?/]+)/)||[])[1]||'';
            const visible=el=>{{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;}};
            const mismatch=Array.from(document.querySelectorAll('[role=dialog],.dialog-wrap,.boss-dialog,[class*=dialog]'))
                .some(el=>visible(el)&&/工作经历不匹配/.test(el.innerText||''));
            return current===expected&&!mismatch;
        """

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
