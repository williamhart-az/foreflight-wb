#!/usr/bin/env python3
"""
Sanitized proof of concept: read aircraft W&B basics from ForeFlight Web.

This script is intentionally limited to read-only aircraft profile data. It uses
an already authenticated ForeFlight Web session and extracts only:

  - tail number / callsign
  - registration
  - Basic Empty Weight / Mass
  - Basic Empty Arm

No credentials, account IDs, aircraft IDs, cookies, or tokens are stored in this
file. Provide them at runtime through environment variables.

Required environment variables:

  FOREFLIGHT_ACCOUNT_ID
      ForeFlight account UUID visible in the Web backend request URL.

  FOREFLIGHT_COOKIE_HEADER
      Full Cookie request header copied from an authenticated
      https://plan.foreflight.com browser session.

  FOREFLIGHT_XSRF_TOKEN
      XSRF token copied from the authenticated browser request.

Optional environment variables:

  FOREFLIGHT_AIRCRAFT_IDS
      Comma-separated aircraft UUIDs. If set, the script skips the list request
      and fetches only these aircraft detail records.

  FOREFLIGHT_LIST_URL
      Full aircraft list endpoint copied from the browser Network tab.
      Defaults to:
      https://plan.foreflight.com/aircraft/api/v2/{account_id}/list?includeSharedObjects=true

Important implementation note:

  The aircraft list endpoint used by the ForeFlight Web app is called with HTTP
  PUT and an empty filter body. In this context it behaves as a read/list query;
  this script does not create, update, or delete any ForeFlight data. Aircraft
  detail records are then fetched with HTTP GET.

Example:

  export FOREFLIGHT_ACCOUNT_ID="..."
  export FOREFLIGHT_COOKIE_HEADER="..."
  export FOREFLIGHT_XSRF_TOKEN="..."

  python3 foreflight_wb_sync_sanitized.py --dry-run
  python3 foreflight_wb_sync_sanitized.py --output aircraft_wb_rows.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_OUTPUT = Path("aircraft_wb_rows.csv")
REQUEST_TIMEOUT_SECONDS = 30


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Missing required environment variable: {name}")
    return value


def request_json(url: str, *, method: str = "GET", body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Send one authenticated ForeFlight Web request and parse the JSON response."""

    payload = None if body is None else json.dumps(body).encode("utf-8")
    request = Request(url, data=payload, method=method)
    request.add_header("accept", "*/*")
    request.add_header("content-type", "application/json")
    request.add_header("cookie", required_env("FOREFLIGHT_COOKIE_HEADER"))
    request.add_header("x-xsrftoken", required_env("FOREFLIGHT_XSRF_TOKEN"))

    try:
        with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:1000]
        raise RuntimeError(f"ForeFlight request returned HTTP {error.code} for {url}: {detail}") from error
    except URLError as error:
        raise RuntimeError(f"ForeFlight request failed for {url}: {error}") from error


def get_aircraft_ids(account_id: str) -> list[str]:
    """Return aircraft UUIDs visible to the authenticated account."""

    explicit_ids = [
        item.strip()
        for item in os.environ.get("FOREFLIGHT_AIRCRAFT_IDS", "").split(",")
        if item.strip()
    ]
    if explicit_ids:
        return explicit_ids

    list_url = os.environ.get(
        "FOREFLIGHT_LIST_URL",
        f"https://plan.foreflight.com/aircraft/api/v2/{account_id}/list?includeSharedObjects=true",
    )

    # ForeFlight Web uses PUT for this list/filter query. The empty filter does
    # not modify data; it returns aircraft visible to the authenticated account.
    data = request_json(list_url, method="PUT", body={"filter": {}})
    aircraft = data.get("aircraft", [])
    return [str(item["uuid"]) for item in aircraft if isinstance(item, dict) and item.get("uuid")]


def fetch_aircraft_detail(account_id: str, aircraft_id: str) -> dict[str, Any]:
    """Fetch one aircraft detail JSON record by ForeFlight aircraft UUID."""

    url = f"https://plan.foreflight.com/aircraft/api/v2/{account_id}/{aircraft_id}"
    return request_json(url)


def find_key(value: Any, key: str) -> Any:
    """Recursively find the first occurrence of a key in nested JSON."""

    if isinstance(value, dict):
        if key in value:
            return value[key]
        for child in value.values():
            found = find_key(child, key)
            if found is not None:
                return found
    elif isinstance(value, list):
        for child in value:
            found = find_key(child, key)
            if found is not None:
                return found
    return None


def nested_get(value: Any, path: list[str]) -> Any:
    current = value
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def first_text(*values: Any) -> str:
    for value in values:
        text = str(value or "").strip()
        if text:
            return text
    return ""


def parse_number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, (int, float)):
        return float(value)

    try:
        return float(str(value).strip().replace(",", ""))
    except ValueError:
        return None


def format_number(value: float | None) -> str:
    if value is None:
        return ""
    return f"{value:.8f}".rstrip("0").rstrip(".")


def extract_wb_rows(data: dict[str, Any]) -> list[dict[str, str]]:
    """Extract one CSV row per W&B profile found in an aircraft detail JSON."""

    aircraft = data.get("aircraft") if isinstance(data.get("aircraft"), dict) else {}
    wb_profiles = data.get("wbProfiles") if isinstance(data.get("wbProfiles"), list) else []

    tail_number = first_text(
        aircraft.get("tailNumber"),
        aircraft.get("callSign"),
        aircraft.get("callsign"),
        find_key(data, "tailNumber"),
    )
    registration = first_text(
        aircraft.get("otherInfoReg"),
        aircraft.get("registration"),
        aircraft.get("aircraftRegistration"),
        find_key(data, "otherInfoReg"),
    )

    rows: list[dict[str, str]] = []
    profiles = wb_profiles or [None]

    for wb_profile in profiles:
        profile_json = wb_profile.get("profileJson", {}) if isinstance(wb_profile, dict) else data
        basic_info = nested_get(profile_json, ["weightBalanceData", "basicInfo"]) or {}

        basic_empty_weight = parse_number(
            basic_info.get("basicEmptyWeight") if isinstance(basic_info, dict) else None
        )
        if basic_empty_weight is None:
            basic_empty_weight = parse_number(find_key(profile_json, "basicEmptyWeight"))

        basic_empty_arm = parse_number(
            nested_get(basic_info, ["basicEmptyArm", "longitudinalCgArm"])
            if isinstance(basic_info, dict)
            else None
        )
        if basic_empty_arm is None:
            basic_empty_arm = parse_number(find_key(profile_json, "longitudinalCgArm"))

        if basic_empty_weight is None and basic_empty_arm is None:
            continue

        rows.append(
            {
                "tail_number": tail_number,
                "registration": registration,
                "basic_empty_weight": format_number(basic_empty_weight),
                "basic_empty_arm_longitudinal": format_number(basic_empty_arm),
            }
        )

    return rows


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    rows = sorted(rows, key=lambda row: (row["tail_number"], row["registration"]))
    path.parent.mkdir(parents=True, exist_ok=True)

    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "tail_number",
                "registration",
                "basic_empty_weight",
                "basic_empty_arm_longitudinal",
            ],
        )
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Read ForeFlight aircraft W&B basics into a local CSV.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help=f"CSV output path; default: {DEFAULT_OUTPUT}")
    parser.add_argument("--dry-run", action="store_true", help="Fetch data and print a short summary without writing CSV.")
    args = parser.parse_args()

    account_id = required_env("FOREFLIGHT_ACCOUNT_ID")
    aircraft_ids = get_aircraft_ids(account_id)
    print(f"Found {len(aircraft_ids)} aircraft visible to this authenticated account.")

    rows: list[dict[str, str]] = []
    for index, aircraft_id in enumerate(aircraft_ids, start=1):
        data = fetch_aircraft_detail(account_id, aircraft_id)
        extracted_rows = extract_wb_rows(data)
        rows.extend(extracted_rows)
        print(f"[{index}/{len(aircraft_ids)}] {aircraft_id}: extracted {len(extracted_rows)} W&B row(s)")

    if args.dry_run:
        print(json.dumps(rows[:5], indent=2))
        print(f"[DRY RUN] Would write {len(rows)} row(s) to {args.output}")
        return 0

    write_csv(args.output, rows)
    print(f"Wrote {len(rows)} row(s) to {args.output}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
