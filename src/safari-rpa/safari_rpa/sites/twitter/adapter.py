from __future__ import annotations

import asyncio
import json
from typing import Any
from urllib.parse import urlparse

from safari_rpa.contracts.errors import ErrorKind, RpaError
from safari_rpa.contracts.safari import PageCondition, PageRef, SafariAutomationPort


class TwitterPageAdapter:
    ORIGIN = "x.com"
    START_URL = "https://x.com/home"

    def __init__(self, safari: SafariAutomationPort):
        self.safari = safari

    async def ensure_profile(self, *, handle: str | None = None, profile_url: str | None = None) -> PageRef:
        url = self.profile_url(handle=handle, profile_url=profile_url)
        page = await self.safari.ensure_site(self.ORIGIN, url)
        await self.safari.navigate(page, url)
        await self.safari.wait_for(
            page,
            PageCondition.js(
                self._profile_ready_condition(),
                "Twitter profile timeline or an actionable blocking state appears",
            ),
            timeout=45,
        )
        await self.assert_access(page)
        return page

    async def assert_access(self, page: PageRef) -> dict[str, Any]:
        state = await self.safari.evaluate(page, self._access_state_script())
        if not isinstance(state, dict):
            raise RpaError("TWITTER_PAGE_INVALID", "Twitter page state is not readable")
        if state.get("login_required"):
            raise RpaError("TWITTER_LOGIN_REQUIRED", "Twitter login is required", ErrorKind.BLOCKED_AUTH, state)
        if state.get("risk"):
            raise RpaError("TWITTER_RISK_CONTROL", "Twitter requires manual verification", ErrorKind.BLOCKED_RISK, state)
        if state.get("rate_limited"):
            raise RpaError("TWITTER_RATE_LIMITED", "Twitter rate limit or retry state is visible", ErrorKind.BLOCKED_RISK, state)
        return state

    async def read_tweets(
        self,
        page: PageRef,
        *,
        target_handle: str = "",
        include_replies: bool = False,
        include_reposts: bool = False,
        include_quotes: bool = False,
    ) -> list[dict[str, Any]]:
        await self.assert_access(page)
        value = await self.safari.evaluate(page, self._tweet_extraction_script())
        if not isinstance(value, list):
            return []
        return self._normalize_items(
            value,
            target_handle=target_handle,
            include_replies=include_replies,
            include_reposts=include_reposts,
            include_quotes=include_quotes,
        )

    async def read_tweet_detail(
        self,
        page: PageRef,
        url: str,
        *,
        target_handle: str = "",
        timeout: float = 60.0,
        pause_seconds: float = 2.0,
    ) -> dict[str, Any]:
        await self.safari.navigate(page, url)
        if pause_seconds > 0:
            await asyncio.sleep(pause_seconds)
        await self.safari.wait_for(
            page,
            PageCondition.js(
                self._status_ready_condition(url),
                "Twitter status detail or an actionable blocking state appears",
            ),
            timeout=timeout,
        )
        await self.assert_access(page)
        value = await self.safari.evaluate(page, self._tweet_detail_script(url))
        if not isinstance(value, dict):
            raise RpaError("TWITTER_TWEET_DETAIL_INVALID", "Twitter status detail is not readable")
        normalized = self._normalize_items(
            [value],
            target_handle=target_handle,
            include_replies=False,
            include_reposts=False,
            include_quotes=False,
        )
        if not normalized:
            raise RpaError(
                "TWITTER_TWEET_DETAIL_INVALID",
                "Twitter status detail did not contain a target original tweet",
                details={"url": url},
            )
        return normalized[0]

    async def scroll(self, page: PageRef) -> dict[str, Any]:
        value = await self.safari.evaluate(
            page,
            """
            window.scrollBy(0, Math.max(800, Math.floor(window.innerHeight * 0.85)));
            return {scroll_y: window.scrollY, scroll_height: document.documentElement.scrollHeight};
            """,
        )
        return value if isinstance(value, dict) else {}

    @classmethod
    def profile_url(cls, *, handle: str | None = None, profile_url: str | None = None) -> str:
        if profile_url:
            parsed = urlparse(profile_url if "://" in profile_url else f"https://x.com/{profile_url.lstrip('@/')}")
            parts = [part for part in parsed.path.split("/") if part]
            if not parts:
                raise RpaError("TWITTER_TARGET_INVALID", "Twitter profile URL does not contain a handle")
            return f"https://x.com/{parts[0].lstrip('@')}"
        normalized = cls.normalize_handle(handle or "")
        if not normalized:
            raise RpaError("TWITTER_TARGET_INVALID", "Twitter handle or profile_url is required")
        return f"https://x.com/{normalized}"

    @staticmethod
    def normalize_handle(value: str) -> str:
        cleaned = value.strip()
        if "://" in cleaned:
            parsed = urlparse(cleaned)
            parts = [part for part in parsed.path.split("/") if part]
            return (parts[0] if parts else "").lstrip("@")
        if cleaned.lower().startswith(("x.com/", "twitter.com/", "www.x.com/", "www.twitter.com/")):
            parsed = urlparse(f"https://{cleaned}")
            parts = [part for part in parsed.path.split("/") if part]
            return (parts[0] if parts else "").lstrip("@")
        return cleaned.removeprefix("@").split("/")[0].strip()

    @classmethod
    def _normalize_items(
        cls,
        value: list[Any],
        *,
        target_handle: str = "",
        include_replies: bool = False,
        include_reposts: bool = False,
        include_quotes: bool = True,
    ) -> list[dict[str, Any]]:
        target = cls.normalize_handle(target_handle).lower()
        records: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in value:
            if not isinstance(item, dict):
                continue
            tweet_id = str(item.get("tweet_id") or "").strip()
            text = str(item.get("text") or "").strip()
            url = str(item.get("url") or "").strip()
            if not tweet_id or not text or not url or tweet_id in seen:
                continue
            author = cls.normalize_handle(str(item.get("author_handle") or "")).lower()
            is_reply = bool(item.get("is_reply"))
            is_repost = bool(item.get("is_repost"))
            is_quote = bool(item.get("is_quote"))
            if target and author != target:
                continue
            if is_reply and not include_replies:
                continue
            if is_repost and not include_reposts:
                continue
            if is_quote and not include_quotes:
                continue
            seen.add(tweet_id)
            records.append(
                {
                    "tweet_id": tweet_id,
                    "url": url,
                    "author_handle": author or cls.normalize_handle(str(item.get("author_handle") or "")),
                    "created_at": str(item.get("created_at") or ""),
                    "text": text,
                    "is_reply": is_reply,
                    "is_repost": is_repost,
                    "is_quote": is_quote,
                }
            )
        return records

    @staticmethod
    def _profile_ready_condition() -> str:
        return """
        const text=document.body?.innerText||'';
        return !!document.querySelector('[data-testid="primaryColumn"] article[data-testid="tweet"]') ||
            !!document.querySelector('[data-testid="primaryColumn"]') ||
            /Log in|Sign in|登录|Something went wrong|Rate limit|Try again|验证码|安全验证/.test(text);
        """

    @staticmethod
    def _status_ready_condition(url: str) -> str:
        tweet_id = json.dumps(TwitterPageAdapter._tweet_id_from_url(url))
        return f"""
        const text=document.body?.innerText||'';
        const expected={tweet_id};
        const blocking=/Log in|Sign in|登录|Something went wrong|Rate limit|Try again|验证码|安全验证/.test(text);
        const titleTweet=(document.title.match(/[“"](.*?)[”"]\\s*\\/\\s*X/)||[])[1]||'';
        const primary=document.querySelector('[data-testid="primaryColumn"]');
        const primaryText=(primary?.innerText||'').trim();
        const skeleton=!!primary?.querySelector('[role="progressbar"],[aria-busy="true"],[data-testid="placeholder"]');
        const onStatus=location.href.includes('/status/'+expected);
        const matchingArticle=Array.from(primary?.querySelectorAll('article[data-testid="tweet"]')||[]).find(article =>
            Array.from(article.querySelectorAll('a[href*="/status/"]'))
                .some(link => String(link.getAttribute('href')||link.href||'').includes('/status/'+expected))
        );
        const articleReady=!!matchingArticle && matchingArticle.innerText.length > 0;
        const primaryReady=!!primary && primaryText.length > 0 && !skeleton;
        return (onStatus && ((primaryReady && articleReady) || titleTweet.length > 0)) || blocking;
        """

    @staticmethod
    def _access_state_script() -> str:
        return r"""
        /* twitter_access_state */
        const text=document.body?.innerText||'';
        const url=location.href;
        const title=document.title||'';
        const login_required=/\/login|\/i\/flow\/login/.test(url) ||
            /\b(Log in|Sign in)\b|登录|注册/.test(text);
        const rate_limited=/Rate limit|Try again later|Something went wrong|请稍后再试|操作频繁/.test(text);
        const risk=/验证码|安全验证|suspicious activity|unusual login|账号异常|Access denied/i.test(text) ||
            /Access denied|403 Forbidden/i.test(title);
        const has_timeline=!!document.querySelector('[data-testid="primaryColumn"] article[data-testid="tweet"]');
        const has_profile=!!document.querySelector('[data-testid="primaryColumn"]');
        return {login_required,risk,rate_limited,has_timeline,has_profile,url};
        """

    @staticmethod
    def _tweet_extraction_script() -> str:
        return r"""
        /* twitter_extract_tweets */
        const handleFromHref=href => {
            const part=String(href||'').split('?')[0].split('/').filter(Boolean)[0]||'';
            return part.replace(/^@/,'');
        };
        const tweetIdFromHref=href => (String(href||'').match(/\/status\/(\d+)/)||[])[1]||'';
        const absolute=href => {
            try { return new URL(href, location.origin).href; } catch { return ''; }
        };
        const root=document.querySelector('[data-testid="primaryColumn"]') || document;
        return Array.from(root.querySelectorAll('article[data-testid="tweet"]')).map(article => {
            const textNodes=Array.from(article.querySelectorAll('[data-testid="tweetText"]'));
            const ownText=(textNodes[0]?.innerText||textNodes[0]?.textContent||'').trim();
            const time=article.querySelector('time');
            const statusLink=time?.closest('a[href*="/status/"]') || article.querySelector('a[href*="/status/"]');
            const href=statusLink?.getAttribute('href')||statusLink?.href||'';
            const userLink=article.querySelector('[data-testid="User-Name"] a[href^="/"]') ||
                article.querySelector('a[role="link"][href^="/"]');
            const social=(article.querySelector('[data-testid="socialContext"]')?.innerText||'').trim();
            const body=article.innerText||'';
            return {
                tweet_id: tweetIdFromHref(href),
                url: absolute(href),
                author_handle: handleFromHref(userLink?.getAttribute('href')||userLink?.href||''),
                created_at: time?.getAttribute('datetime')||'',
                text: ownText,
                is_reply: /Replying to|回复给|正在回复/.test(body),
                is_repost: /Reposted|Retweeted|转帖|转发/.test(social),
                is_quote: textNodes.length > 1
            };
        });
        """

    @staticmethod
    def _tweet_detail_script(url: str) -> str:
        expected = json.dumps(TwitterPageAdapter._tweet_id_from_url(url))
        return f"""
        /* twitter_extract_tweet_detail */
        const expected={expected};
        const handleFromHref=href => {{
            const part=String(href||'').split('?')[0].split('/').filter(Boolean)[0]||'';
            return part.replace(/^@/,'');
        }};
        const tweetIdFromHref=href => (String(href||'').match(/\\/status\\/(\\d+)/)||[])[1]||'';
        const absolute=href => {{
            try {{ return new URL(href, location.origin).href; }} catch {{ return ''; }}
        }};
        const titleTweet=(document.title.match(/[“"](.*?)[”"]\\s*\\/\\s*X/)||[])[1]||'';
        const root=document.querySelector('[data-testid="primaryColumn"]') || document;
        const articles=Array.from(root.querySelectorAll('article[data-testid="tweet"]'));
        const article=articles.find(candidate =>
            Array.from(candidate.querySelectorAll('a[href*="/status/"]'))
                .some(link => tweetIdFromHref(link.getAttribute('href')||link.href||'') === expected)
        ) || articles[0];
        if (!article) return {{
            tweet_id: expected,
            url: location.href,
            author_handle: handleFromHref(location.pathname),
            created_at: '',
            text: titleTweet,
            is_reply: false,
            is_repost: false,
            is_quote: false
        }};
        const textNodes=Array.from(article.querySelectorAll('[data-testid="tweetText"]'));
        const ownText=(textNodes[0]?.innerText||textNodes[0]?.textContent||titleTweet||'').trim();
        const time=article.querySelector('time');
        const statusLink=Array.from(article.querySelectorAll('a[href*="/status/"]'))
            .find(link => tweetIdFromHref(link.getAttribute('href')||link.href||'') === expected) ||
            time?.closest('a[href*="/status/"]') ||
            article.querySelector('a[href*="/status/"]');
        const href=statusLink?.getAttribute('href')||statusLink?.href||'';
        const userLink=article.querySelector('[data-testid="User-Name"] a[href^="/"]') ||
            article.querySelector('a[role="link"][href^="/"]');
        const social=(article.querySelector('[data-testid="socialContext"]')?.innerText||'').trim();
        const body=article.innerText||'';
        return {{
            tweet_id: tweetIdFromHref(href) || expected,
            url: absolute(href || location.href),
            author_handle: handleFromHref(userLink?.getAttribute('href')||userLink?.href||''),
            created_at: time?.getAttribute('datetime')||'',
            text: ownText,
            is_reply: /Replying to|回复给|正在回复/.test(body),
            is_repost: /Reposted|Retweeted|转帖|转发/.test(social),
            is_quote: textNodes.length > 1
        }};
        """

    @staticmethod
    def _tweet_id_from_url(url: str) -> str:
        return (str(url).split("?")[0].split("/status/")[-1].split("/")[0] if "/status/" in str(url) else "").strip()
