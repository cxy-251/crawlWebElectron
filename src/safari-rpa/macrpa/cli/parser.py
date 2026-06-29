from __future__ import annotations

import argparse
from pathlib import Path

from macrpa import __version__
from macrpa.paths import default_config_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="safari-rpa", description="Safari RPA Runtime")
    parser.add_argument("--version", action="version", version=__version__)
    parser.add_argument("--home", type=Path, help="Runtime state directory (default: SAFARI_RPA_HOME, MACRPA_HOME, or local-api-usage/safari-rpa/var)")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("doctor", help="Check the local Safari automation environment")
    subparsers.add_parser("workflows", help="List workflow contracts")

    run_parser = subparsers.add_parser("run", help="Create and execute a workflow run")
    run_parser.add_argument("workflow_id")
    run_parser.add_argument("--config", type=Path)
    run_parser.add_argument("--input", type=Path)
    run_parser.add_argument("--profile", help="Select a named workflow profile from the config")

    twitter_parser = subparsers.add_parser("twitter", help="Convenience wrappers for Twitter workflows")
    twitter_subparsers = twitter_parser.add_subparsers(dest="twitter_command", required=True)
    twitter_collect = twitter_subparsers.add_parser("collect", help="Collect raw original tweets without LLM cleanup")
    twitter_collect.add_argument("--config", type=Path, default=default_config_path("twitter.collect.yaml"))
    twitter_collect.add_argument("--input", type=Path, default=default_config_path("twitter-target.json"))
    twitter_clean = twitter_subparsers.add_parser("clean", help="Clean previously collected Twitter raw tweets")
    twitter_clean.add_argument("--config", type=Path, default=default_config_path("twitter.clean.yaml"))
    twitter_clean.add_argument("--input", type=Path, default=default_config_path("twitter-target.json"))

    status_parser = subparsers.add_parser("status", help="Show one run or recent runs")
    status_parser.add_argument("run_id", nargs="?")
    status_parser.add_argument("--limit", type=int, default=20)

    resume_parser = subparsers.add_parser("resume", help="Resume a blocked or failed run")
    resume_parser.add_argument("run_id")

    cancel_parser = subparsers.add_parser("cancel", help="Request cooperative cancellation")
    cancel_parser.add_argument("run_id")

    artifacts_parser = subparsers.add_parser("artifacts", help="List run artifacts")
    artifacts_parser.add_argument("run_id")

    reports_parser = subparsers.add_parser("reports", help="List, show, or rebuild daily reports")
    reports_subparsers = reports_parser.add_subparsers(dest="reports_command", required=True)
    reports_list = reports_subparsers.add_parser("list", help="List registered reports")
    reports_list.add_argument("--limit", type=int, default=100)
    reports_show = reports_subparsers.add_parser("show", help="Show report metadata or CSV content")
    reports_show.add_argument("report_id")
    reports_show.add_argument("--content", action="store_true")
    reports_rebuild = reports_subparsers.add_parser("rebuild", help="Rebuild one Boss daily report from SQLite")
    reports_rebuild.add_argument("--date", help="Asia/Shanghai date in YYYY-MM-DD form")

    schedule_parser = subparsers.add_parser("schedule", help="Install, inspect, or uninstall LaunchAgents")
    schedule_subparsers = schedule_parser.add_subparsers(dest="schedule_command", required=True)
    schedule_install = schedule_subparsers.add_parser("install", help="Install the Boss production schedule")
    schedule_install.add_argument("--id", default="boss-production-daily")
    schedule_install.add_argument("--config", type=Path, default=default_config_path("boss.production.yaml"))
    schedule_install.add_argument("--profile", default="production")
    schedule_install.add_argument("--at", default="06:00")
    schedule_install.add_argument("--timezone", default="Asia/Shanghai")
    schedule_install.add_argument("--no-keep-awake", action="store_true")
    schedule_status = schedule_subparsers.add_parser("status", help="List schedules or inspect one")
    schedule_status.add_argument("schedule_id", nargs="?")
    schedule_remove = schedule_subparsers.add_parser("uninstall", help="Unload and remove a schedule")
    schedule_remove.add_argument("schedule_id", nargs="?", default="boss-production-daily")

    scheduled_parser = subparsers.add_parser("scheduled-run", help=argparse.SUPPRESS)
    scheduled_parser.add_argument("workflow_id")
    scheduled_parser.add_argument("--config", type=Path, required=True)
    scheduled_parser.add_argument("--profile", default="production")
    scheduled_parser.add_argument("--ready-until", default="12:00")
    scheduled_parser.add_argument("--retry-seconds", type=int, default=300)

    serve_parser = subparsers.add_parser("serve", help="Run the loopback REST and SSE service")
    serve_parser.add_argument("--host", default="127.0.0.1")
    serve_parser.add_argument("--port", type=int, default=3211)
    return parser
