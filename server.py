"""Local CLI bridges (Codex + Antigravity) and static server for ai-workstation.

Serves static files from the repository directory on 127.0.0.1 and exposes:
- GET  /api/codex/status          Reads non-secret local Codex config/models & top-3 sessions.
- GET  /api/codex/history         Reads safe user/assistant summary turns for a Codex session.
- POST /api/codex/chat            Runs `codex exec` (or `codex exec resume`) in read-only sandbox.
- GET  /api/antigravity/status    Reads non-secret local Antigravity CLI models & top-3 conversations.
- GET  /api/antigravity/history   Reads safe user/assistant summary turns for an Antigravity thread.
- POST /api/antigravity/chat      Runs `agy --sandbox` in local workspace or isolated cloud mode.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import subprocess
import tempfile
import time
import tomllib
from urllib.parse import parse_qs, unquote, urlparse

REPO_ROOT = Path(__file__).resolve().parent
CODEX_HOME = Path.home() / ".codex"
ANTIGRAVITY_HOME = Path.home() / ".gemini" / "antigravity"
ANTIGRAVITY_CLI_CFG = Path.home() / ".gemini" / "antigravity-cli" / "settings.json"

VALID_SLUG_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
VALID_CONV_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
VALID_EFFORTS = {"low", "medium", "high", "xhigh", "max"}
VALID_AGY_EFFORTS = {"low", "medium", "high"}
MAX_BODY_BYTES = 32 * 1024

_CLI_VERSION_CACHE: dict[str, str | None] = {"bin": None, "version": None}
_AGY_MODELS_CACHE: dict = {
    "bin": None,
    "fetched": 0.0,
    "models": [],
    "slugs": {},
    "slug_to_display": {},
}
_SESSION_TURNS_CACHE: dict[str, list[dict]] = {}


def _cache_turn(conv_id: str | None, user_text: str, assistant_text: str):
    if not conv_id:
        return
    turns = _SESSION_TURNS_CACHE.setdefault(conv_id, [])
    turns.append({"role": "user", "text": user_text[:450]})
    turns.append({"role": "assistant", "text": assistant_text[:450]})
    if len(turns) > 12:
        del turns[:-12]
    if len(_SESSION_TURNS_CACHE) > 50:
        oldest = next(iter(_SESSION_TURNS_CACHE))
        if oldest != conv_id:
            _SESSION_TURNS_CACHE.pop(oldest, None)


def _subprocess_kwargs(timeout: int = 15) -> dict:
    kwargs: dict = {"capture_output": True, "timeout": timeout}
    if os.name == "nt":
        kwargs["creationflags"] = 0x08000000
    return kwargs


def _clean_title(text: str | None, fallback: str = "未命名对话", max_len: int = 34) -> str:
    if not isinstance(text, str):
        return fallback
    cleaned = text
    cleaned = re.sub(r"<ADDITIONAL_METADATA>.*", "", cleaned, flags=re.S)
    cleaned = re.sub(r"</?USER_REQUEST>", " ", cleaned)
    cleaned = re.sub(r"\[?\$[A-Za-z0-9_-]+\]?\([^)]*\)", " ", cleaned)
    cleaned = re.sub(r"[#*_`]+", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if not cleaned:
        return fallback
    if len(cleaned) > max_len:
        return cleaned[: max_len - 1].rstrip() + "…"
    return cleaned


def _format_timestamp(raw_ts: str | None, fallback_mtime: float = 0.0) -> str:
    if isinstance(raw_ts, str) and raw_ts.strip():
        txt = raw_ts.strip().replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(txt)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone().strftime("%Y-%m-%d %H:%M")
        except ValueError:
            pass
    if fallback_mtime > 0:
        return datetime.fromtimestamp(fallback_mtime).strftime("%Y-%m-%d %H:%M")
    return "最近"


def _strip_user_markup(text: str) -> str:
    cleaned = re.sub(r"<ADDITIONAL_METADATA>.*", "", text, flags=re.S)
    cleaned = re.sub(r"</?USER_REQUEST>", "", cleaned)
    return cleaned.strip()


# ---------------------------------------------------------------------------
# Codex CLI helpers
# ---------------------------------------------------------------------------

def _find_codex_bin() -> str | None:
    return shutil.which("codex.cmd") or shutil.which("codex")


def _get_cli_version(codex_bin: str | None) -> str | None:
    if not codex_bin:
        return None
    if _CLI_VERSION_CACHE["bin"] == codex_bin and _CLI_VERSION_CACHE["version"]:
        return _CLI_VERSION_CACHE["version"]
    try:
        proc = subprocess.run([codex_bin, "--version"], **_subprocess_kwargs(10))
        out = proc.stdout.decode("utf-8", errors="replace").strip()
        if proc.returncode == 0 and out:
            _CLI_VERSION_CACHE["bin"] = codex_bin
            _CLI_VERSION_CACHE["version"] = out.splitlines()[0].strip()
            return _CLI_VERSION_CACHE["version"]
    except Exception:
        pass
    return None


def _read_config_defaults() -> tuple[str | None, str]:
    cfg_path = CODEX_HOME / "config.toml"
    if not cfg_path.is_file():
        return None, "high"
    try:
        data = tomllib.loads(cfg_path.read_text(encoding="utf-8"))
    except Exception:
        return None, "high"
    model = data.get("model") if isinstance(data.get("model"), str) else None
    effort = data.get("model_reasoning_effort")
    effort_str = effort.strip().lower() if isinstance(effort, str) else "high"
    if effort_str not in VALID_EFFORTS:
        effort_str = "high"
    return model, effort_str


def _read_models_cache() -> tuple[list[str], dict[str, str], dict[str, str], str | None]:
    cache_path = CODEX_HOME / "models_cache.json"
    if not cache_path.is_file():
        return [], {}, {}, None
    try:
        data = json.loads(cache_path.read_text(encoding="utf-8"))
    except Exception:
        return [], {}, {}, None

    models: list[str] = []
    model_slugs: dict[str, str] = {}
    slug_to_display: dict[str, str] = {}
    for entry in data.get("models", []):
        if not isinstance(entry, dict) or entry.get("visibility") != "list":
            continue
        slug = entry.get("slug")
        display = entry.get("display_name") or slug
        if not isinstance(slug, str) or not isinstance(display, str):
            continue
        models.append(display)
        model_slugs[display] = slug
        slug_to_display[slug] = display

    fetched_at = data.get("fetched_at")
    fetched_date = fetched_at[:10] if isinstance(fetched_at, str) and len(fetched_at) >= 10 else None
    return models, model_slugs, slug_to_display, fetched_date


def _extract_codex_session_meta(path: Path, mtime: float) -> dict | None:
    sid: str | None = None
    project = "workspace"
    ts_str = datetime.fromtimestamp(mtime).strftime("%Y-%m-%d %H:%M")
    first_msg: str | None = None

    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for idx, line in enumerate(fh):
                if idx >= 60:
                    break
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except ValueError:
                    continue
                otype = obj.get("type")
                payload = obj.get("payload") if isinstance(obj.get("payload"), dict) else {}
                if otype == "session_meta":
                    raw_id = payload.get("id")
                    if isinstance(raw_id, str) and VALID_CONV_ID_RE.match(raw_id):
                        sid = raw_id
                    cwd = payload.get("cwd")
                    if isinstance(cwd, str) and cwd.strip():
                        base = Path(cwd.strip()).name
                        if base:
                            project = base
                    ts_str = _format_timestamp(obj.get("timestamp") or payload.get("timestamp"), mtime)
                elif first_msg is None and otype == "event_msg" and payload.get("type") == "user_message":
                    msg = payload.get("message")
                    if isinstance(msg, str) and msg.strip():
                        first_msg = msg.strip()
                elif first_msg is None and otype == "response_item" and payload.get("role") == "user":
                    content = payload.get("content")
                    if isinstance(content, list):
                        for part in content:
                            if isinstance(part, dict) and part.get("type") in {"input_text", "text"}:
                                txt = (part.get("text") or "").strip()
                                if (
                                    txt
                                    and not txt.startswith("<environment_context>")
                                    and not txt.startswith("# AGENTS.md")
                                    and not txt.startswith("<INSTRUCTIONS>")
                                    and not txt.startswith("<turn_aborted>")
                                ):
                                    first_msg = txt
                                    break
                if sid and first_msg:
                    break
    except Exception:
        return None

    if not sid:
        return None
    return {
        "id": sid,
        "title": _clean_title(first_msg, f"{project} 会话"),
        "project": project,
        "time": ts_str,
        "mode": "local",
        "modeLabel": "本地 CLI",
        "source": "bridge",
    }


def _read_codex_recent_sessions(limit: int = 3) -> list[dict]:
    sessions_dir = CODEX_HOME / "sessions"
    if not sessions_dir.is_dir():
        return []
    candidates: list[tuple[float, Path]] = []
    try:
        for path in sessions_dir.rglob("*.jsonl"):
            try:
                candidates.append((path.stat().st_mtime, path))
            except OSError:
                continue
    except Exception:
        return []

    candidates.sort(key=lambda item: item[0], reverse=True)
    recent: list[dict] = []
    seen: set[str] = set()
    for mtime, path in candidates[:24]:
        info = _extract_codex_session_meta(path, mtime)
        if not info or info["id"] in seen:
            continue
        seen.add(info["id"])
        recent.append(info)
        if len(recent) >= limit:
            break
    return recent


def _find_codex_session_file(session_id: str) -> Path | None:
    if not VALID_CONV_ID_RE.match(session_id):
        return None
    sessions_dir = CODEX_HOME / "sessions"
    if not sessions_dir.is_dir():
        return None
    root_resolved = sessions_dir.resolve()
    candidates: list[tuple[float, Path]] = []
    try:
        for path in sessions_dir.rglob("*.jsonl"):
            resolved = path.resolve()
            if not resolved.is_relative_to(root_resolved):
                continue
            if session_id in path.name:
                return resolved
            try:
                candidates.append((path.stat().st_mtime, resolved))
            except OSError:
                continue
    except Exception:
        return None

    candidates.sort(key=lambda item: item[0], reverse=True)
    for _, resolved in candidates[:40]:
        try:
            with resolved.open("r", encoding="utf-8", errors="replace") as fh:
                first_line = fh.readline().strip()
            if not first_line:
                continue
            obj = json.loads(first_line)
            if obj.get("type") == "session_meta":
                payload = obj.get("payload") if isinstance(obj.get("payload"), dict) else {}
                if payload.get("id") == session_id:
                    return resolved
        except Exception:
            continue
    return None


def _read_codex_history(session_id: str, max_msgs: int = 6) -> list[dict] | None:
    path = _find_codex_session_file(session_id)
    if not path or not path.is_file():
        return None

    event_msgs: list[dict] = []
    resp_msgs: list[dict] = []
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except ValueError:
                    continue
                otype = obj.get("type")
                payload = obj.get("payload") if isinstance(obj.get("payload"), dict) else {}
                if otype == "event_msg":
                    ptype = payload.get("type")
                    if ptype in {"user_message", "agent_message"}:
                        txt = (payload.get("message") or "").strip()
                        if txt:
                            event_msgs.append({
                                "role": "user" if ptype == "user_message" else "assistant",
                                "text": txt[:450],
                            })
                elif otype == "response_item" and payload.get("role") in {"user", "assistant"}:
                    content = payload.get("content")
                    if not isinstance(content, list):
                        continue
                    texts = []
                    for part in content:
                        if isinstance(part, dict) and part.get("type") in {"input_text", "output_text", "text"}:
                            txt = (part.get("text") or "").strip()
                            if (
                                txt
                                and not txt.startswith("<environment_context>")
                                and not txt.startswith("# AGENTS.md")
                                and not txt.startswith("<INSTRUCTIONS>")
                                and not txt.startswith("<turn_aborted>")
                            ):
                                texts.append(txt)
                    joined = "\n".join(texts).strip()
                    if joined:
                        resp_msgs.append({"role": payload["role"], "text": joined[:450]})
    except Exception:
        return None

    chosen = event_msgs if event_msgs else resp_msgs
    return chosen[-max_msgs:]


def build_codex_status() -> dict:
    codex_bin = _find_codex_bin()
    cli_version = _get_cli_version(codex_bin)
    cfg_slug, effort = _read_config_defaults()
    models, model_slugs, slug_to_display, fetched_at = _read_models_cache()
    recent = _read_codex_recent_sessions(3)

    default_slug = cfg_slug or (model_slugs[models[0]] if models else "gpt-6.2-sol")
    default_display = slug_to_display.get(default_slug, default_slug)
    if default_display not in models and default_display:
        models.insert(0, default_display)
        model_slugs[default_display] = default_slug

    connected = bool(codex_bin and cli_version)
    return {
        "connected": connected,
        "cliVersion": cli_version,
        "defaultModel": default_display,
        "defaultModelSlug": default_slug,
        "thinkingLevel": effort.capitalize(),
        "models": models,
        "modelSlugs": model_slugs,
        "fetchedAt": fetched_at,
        "latestSession": recent[0] if recent else None,
        "recentConversations": recent,
    }


# ---------------------------------------------------------------------------
# Antigravity Desktop / CLI helpers
# ---------------------------------------------------------------------------

def _find_agy_bin() -> str | None:
    found = shutil.which("agy.exe") or shutil.which("agy")
    if found:
        return found
    candidate = Path(os.environ.get("LOCALAPPDATA", "")) / "agy" / "bin" / "agy.exe"
    return str(candidate) if candidate.is_file() else None


def _read_agy_models(agy_bin: str | None) -> tuple[list[str], dict[str, str], dict[str, str]]:
    if not agy_bin:
        return [], {}, {}
    now = time.monotonic()
    if (
        _AGY_MODELS_CACHE["bin"] == agy_bin
        and _AGY_MODELS_CACHE["models"]
        and (now - _AGY_MODELS_CACHE["fetched"]) < 300.0
    ):
        return (
            list(_AGY_MODELS_CACHE["models"]),
            dict(_AGY_MODELS_CACHE["slugs"]),
            dict(_AGY_MODELS_CACHE["slug_to_display"]),
        )

    models: list[str] = []
    model_slugs: dict[str, str] = {}
    slug_to_display: dict[str, str] = {}
    try:
        proc = subprocess.run([agy_bin, "models"], **_subprocess_kwargs(15))
        if proc.returncode == 0:
            raw = proc.stdout.decode("utf-8", errors="replace")
            for line in raw.splitlines():
                stripped = line.strip()
                if not stripped or stripped.startswith("Fetching") or "\t" not in line:
                    continue
                slug, display = line.split("\t", 1)
                slug = slug.strip()
                display = display.strip()
                if not slug or not display:
                    continue
                models.append(display)
                model_slugs[display] = slug
                slug_to_display[slug] = display
    except Exception:
        pass

    if models:
        _AGY_MODELS_CACHE.update({
            "bin": agy_bin,
            "fetched": now,
            "models": list(models),
            "slugs": dict(model_slugs),
            "slug_to_display": dict(slug_to_display),
        })
    return models, model_slugs, slug_to_display


def _read_agy_default_model() -> str | None:
    if not ANTIGRAVITY_CLI_CFG.is_file():
        return None
    try:
        data = json.loads(ANTIGRAVITY_CLI_CFG.read_text(encoding="utf-8"))
    except Exception:
        return None
    model = data.get("model") if isinstance(data, dict) else None
    return model.strip() if isinstance(model, str) and model.strip() else None


def _parse_workspace_project(workspace_uris_raw: str | None) -> tuple[str, str | None]:
    if not isinstance(workspace_uris_raw, str) or not workspace_uris_raw.strip():
        return "cloud", None
    try:
        uris = json.loads(workspace_uris_raw)
    except Exception:
        uris = []
    if not isinstance(uris, list):
        return "cloud", None
    for uri in uris:
        if isinstance(uri, str) and uri.strip().lower().startswith("file://"):
            parsed = urlparse(uri.strip())
            decoded_path = unquote(parsed.path or "").rstrip("/\\")
            base = Path(decoded_path).name if decoded_path else ""
            return "local", (base or "本地工作区")
    return "cloud", None


def _read_agy_recent_from_fs(limit: int = 3) -> list[dict]:
    brain_dir = ANTIGRAVITY_HOME / "brain"
    if not brain_dir.is_dir():
        return []
    candidates: list[tuple[float, str, Path]] = []
    try:
        for child in brain_dir.iterdir():
            if not child.is_dir() or not VALID_CONV_ID_RE.match(child.name):
                continue
            tfile = child / ".system_generated" / "logs" / "transcript.jsonl"
            if tfile.is_file():
                try:
                    candidates.append((tfile.stat().st_mtime, child.name, tfile))
                except OSError:
                    continue
    except Exception:
        return []

    candidates.sort(key=lambda item: item[0], reverse=True)
    recent: list[dict] = []
    for mtime, cid, tfile in candidates[:16]:
        first_user: str | None = None
        first_ts: str | None = None
        try:
            with tfile.open("r", encoding="utf-8", errors="replace") as fh:
                for idx, line in enumerate(fh):
                    if idx > 15:
                        break
                    line = line.strip()
                    if not line:
                        continue
                    obj = json.loads(line)
                    if obj.get("type") == "USER_INPUT" and obj.get("source") == "USER_EXPLICIT":
                        first_user = _strip_user_markup(obj.get("content") or "")
                        first_ts = obj.get("created_at")
                        break
        except Exception:
            continue
        if not first_user:
            continue
        recent.append({
            "id": cid,
            "title": _clean_title(first_user, "Antigravity 对话"),
            "project": None,
            "time": _format_timestamp(first_ts, mtime),
            "mode": "local",
            "modeLabel": "本地工作区",
            "active": False,
            "source": "bridge",
        })
        if len(recent) >= limit:
            break
    return recent


def _read_agy_recent_conversations(limit: int = 3) -> list[dict]:
    db_path = ANTIGRAVITY_HOME / "conversation_summaries.db"
    if not db_path.is_file():
        return _read_agy_recent_from_fs(limit)

    recent: list[dict] = []
    try:
        con = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True, timeout=2.0)
        try:
            cur = con.cursor()
            rows = cur.execute(
                """
                SELECT conversation_id, title, preview, last_modified_time, workspace_uris, not_fully_idle
                FROM conversation_summaries
                WHERE nesting_depth = 0
                  AND (parent_conversation_id = '' OR parent_conversation_id IS NULL)
                  AND killed = 0
                  AND step_count > 0
                ORDER BY last_modified_time DESC
                LIMIT 10
                """
            ).fetchall()
        finally:
            con.close()

        for cid, title, preview, mod_time, ws_raw, not_idle in rows:
            if not isinstance(cid, str) or not VALID_CONV_ID_RE.match(cid):
                continue
            mode, project = _parse_workspace_project(ws_raw)
            recent.append({
                "id": cid,
                "title": _clean_title(title or preview, "Antigravity 对话"),
                "project": project,
                "time": _format_timestamp(mod_time),
                "mode": mode,
                "modeLabel": "本地工作区" if mode == "local" else "云端对话",
                "active": bool(not_idle),
                "source": "bridge",
            })
            if len(recent) >= limit:
                break
    except Exception:
        return _read_agy_recent_from_fs(limit)

    return recent if recent else _read_agy_recent_from_fs(limit)


def _is_agy_conversation_active(conv_id: str) -> bool:
    if not VALID_CONV_ID_RE.match(conv_id):
        return False
    db_path = ANTIGRAVITY_HOME / "conversation_summaries.db"
    if not db_path.is_file():
        return False
    try:
        con = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True, timeout=1.5)
        try:
            row = con.execute(
                "SELECT not_fully_idle FROM conversation_summaries WHERE conversation_id = ?",
                (conv_id,),
            ).fetchone()
        finally:
            con.close()
        return bool(row and row[0])
    except Exception:
        return False


def _read_agy_history(conv_id: str, max_msgs: int = 6) -> list[dict] | None:
    if not VALID_CONV_ID_RE.match(conv_id):
        return None
    brain_root = (ANTIGRAVITY_HOME / "brain").resolve()
    tpath = (brain_root / conv_id / ".system_generated" / "logs" / "transcript.jsonl").resolve()

    turns: list[dict] = []
    if tpath.is_relative_to(brain_root) and tpath.is_file():
        try:
            with tpath.open("r", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        obj = json.loads(line)
                    except ValueError:
                        continue
                    stype = obj.get("type")
                    if stype == "USER_INPUT" and obj.get("source") == "USER_EXPLICIT":
                        txt = _strip_user_markup(obj.get("content") or "")
                        if txt:
                            turns.append({"role": "user", "text": txt[:450]})
                    elif stype == "PLANNER_RESPONSE":
                        content = obj.get("content")
                        if isinstance(content, str) and content.strip():
                            turns.append({"role": "assistant", "text": content.strip()[:450]})
        except Exception:
            pass

    if turns:
        return turns[-max_msgs:]

    cached = _SESSION_TURNS_CACHE.get(conv_id)
    if cached:
        return cached[-max_msgs:]

    db_path = ANTIGRAVITY_HOME / "conversation_summaries.db"
    if db_path.is_file():
        try:
            con = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True, timeout=1.5)
            try:
                fts_rows = con.execute(
                    "SELECT user_body, agent_body FROM conversations_fts WHERE conversation_id = ? AND chunk_index >= 0 ORDER BY chunk_index ASC LIMIT 4",
                    (conv_id,),
                ).fetchall()
                for u_body, a_body in fts_rows:
                    if isinstance(u_body, str) and _strip_user_markup(u_body):
                        turns.append({"role": "user", "text": _strip_user_markup(u_body)[:450]})
                    if isinstance(a_body, str) and a_body.strip():
                        turns.append({"role": "assistant", "text": a_body.strip()[:450]})
                if not turns:
                    row = con.execute(
                        "SELECT preview FROM conversation_summaries WHERE conversation_id = ?",
                        (conv_id,),
                    ).fetchone()
                    if row and isinstance(row[0], str) and _strip_user_markup(row[0]):
                        turns.append({"role": "user", "text": _strip_user_markup(row[0])[:450]})
            finally:
                con.close()
        except Exception:
            pass

    return turns[-max_msgs:] if turns else None


def _infer_effort_from_model(name: str | None) -> str | None:
    if not isinstance(name, str):
        return None
    low = name.lower()
    if "high" in low:
        return "High"
    if "medium" in low:
        return "Medium"
    if "low" in low:
        return "Low"
    return None


def _norm_model_key(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.lower())


def _resolve_agy_model(req_model: str | None, status_info: dict) -> tuple[str, str]:
    model_slugs: dict[str, str] = status_info.get("modelSlugs") or {}
    slug_to_display = {v: k for k, v in model_slugs.items()}
    default_slug = status_info.get("defaultModelSlug") or "gemini-3.8-flash-high"

    if isinstance(req_model, str) and req_model.strip():
        raw = req_model.strip()
        if raw in model_slugs:
            return model_slugs[raw], raw
        if raw in slug_to_display:
            return raw, slug_to_display[raw]

        target = _norm_model_key(raw)
        for display, slug in model_slugs.items():
            if _norm_model_key(display) == target or _norm_model_key(slug) == target:
                return slug, display
        for display, slug in model_slugs.items():
            if target and (_norm_model_key(display).endswith(target) or _norm_model_key(slug).endswith(target)):
                return slug, display

    return default_slug, slug_to_display.get(default_slug, default_slug)


def build_antigravity_status() -> dict:
    agy_bin = _find_agy_bin()
    models, model_slugs, slug_to_display = _read_agy_models(agy_bin)
    cfg_default = _read_agy_default_model()
    recent = _read_agy_recent_conversations(3)

    default_display = cfg_default or (models[0] if models else "Gemini 3.8 Flash (High)")
    if default_display in model_slugs:
        default_slug = model_slugs[default_display]
    else:
        default_slug = None
        target = _norm_model_key(default_display)
        for display, slug in model_slugs.items():
            if _norm_model_key(display) == target:
                default_display = display
                default_slug = slug
                break
        if not default_slug:
            default_slug = model_slugs[models[0]] if models else "gemini-3.8-flash-high"
            default_display = slug_to_display.get(default_slug, default_display)

    if default_display and default_display not in models:
        models.insert(0, default_display)
        model_slugs[default_display] = default_slug

    connected = bool(agy_bin and models)
    return {
        "connected": connected,
        "cliPath": "agy.exe" if agy_bin else None,
        "defaultModel": default_display,
        "defaultModelSlug": default_slug,
        "thinkingLevel": _infer_effort_from_model(default_display) or "High",
        "models": models,
        "modelSlugs": model_slugs,
        "modes": ["local", "cloud"],
        "latestConversation": recent[0] if recent else None,
        "recentConversations": recent,
    }


# ---------------------------------------------------------------------------
# HTTP handler & security checks
# ---------------------------------------------------------------------------

def _is_localhost_host(host_header: str | None) -> bool:
    if not host_header:
        return False
    host = host_header.split(":")[0].strip("[]").lower()
    return host in {"localhost", "127.0.0.1", "::1"}


def _is_localhost_origin(origin_header: str | None) -> bool:
    if not origin_header:
        return True
    try:
        parsed = urlparse(origin_header)
    except Exception:
        return False
    return parsed.scheme in {"http", "https"} and (parsed.hostname or "").lower() in {
        "localhost",
        "127.0.0.1",
        "::1",
    }


def _extract_json_line(text: str) -> dict | None:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip().startswith("{")]
    for ln in reversed(lines):
        try:
            obj = json.loads(ln)
            if isinstance(obj, dict):
                return obj
        except ValueError:
            continue
    return None


def _parse_codex_json_events(stdout_text: str) -> tuple[str | None, str]:
    thread_id: str | None = None
    last_msg = ""
    for line in stdout_text.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if obj.get("type") == "thread.started" and isinstance(obj.get("thread_id"), str):
            thread_id = obj["thread_id"]
        elif obj.get("type") == "item.completed":
            item = obj.get("item") if isinstance(obj.get("item"), dict) else {}
            if item.get("type") == "agent_message" and isinstance(item.get("text"), str):
                last_msg = item["text"].strip()
    return thread_id, last_msg


class WorkstationHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "application/javascript; charset=utf-8",
        ".mjs": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(REPO_ROOT), **kwargs)

    def end_headers(self):
        path = urlparse(self.path).path.lower()
        if path == "/" or path.endswith((".html", ".js", ".json", ".css")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> tuple[dict | None, str | None, int]:
        if not _is_localhost_host(self.headers.get("Host")) or not _is_localhost_origin(
            self.headers.get("Origin")
        ):
            return None, "只允许本地来源访问本机桥接接口", HTTPStatus.FORBIDDEN

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None, "无效请求长度", HTTPStatus.BAD_REQUEST

        if length <= 0 or length > MAX_BODY_BYTES:
            return None, "请求内容为空或超出 32KB 上限", HTTPStatus.BAD_REQUEST

        try:
            raw = self.rfile.read(length)
            body = json.loads(raw.decode("utf-8"))
            if not isinstance(body, dict):
                return None, "请求体必须是 JSON 对象", HTTPStatus.BAD_REQUEST
            return body, None, HTTPStatus.OK
        except Exception:
            return None, "请求 JSON 格式错误", HTTPStatus.BAD_REQUEST

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/codex/status":
            self._send_json(HTTPStatus.OK, build_codex_status())
            return

        if parsed.path == "/api/antigravity/status":
            self._send_json(HTTPStatus.OK, build_antigravity_status())
            return

        if parsed.path in {"/api/codex/history", "/api/antigravity/history"}:
            qs = parse_qs(parsed.query)
            conv_id = (qs.get("id") or [""])[0].strip()
            if not VALID_CONV_ID_RE.match(conv_id):
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "无效对话 ID", "messages": []})
                return
            msgs = (
                _read_codex_history(conv_id)
                if parsed.path == "/api/codex/history"
                else _read_agy_history(conv_id)
            )
            self._send_json(
                HTTPStatus.OK,
                {"ok": True, "id": conv_id, "messages": msgs or []},
            )
            return

        rel_parts = [p for p in Path(parsed.path).parts if p not in {"/", "\\"}]
        if any(part.startswith(".") for part in rel_parts):
            self.send_error(HTTPStatus.FORBIDDEN, "Forbidden")
            return

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path not in {"/api/codex/chat", "/api/antigravity/chat"}:
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return

        body, err_msg, err_status = self._read_json_body()
        if body is None:
            self._send_json(err_status, {"ok": False, "error": err_msg})
            return

        if parsed.path == "/api/codex/chat":
            self._handle_codex_chat(body)
        else:
            self._handle_antigravity_chat(body)

    def _handle_codex_chat(self, body: dict):
        prompt = body.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "请输入要发送给 Codex 的内容"})
            return
        prompt = prompt.strip()[:8000]

        conv_id_raw = body.get("conversationId")
        conv_id: str | None = None
        if isinstance(conv_id_raw, str) and conv_id_raw.strip():
            cand = conv_id_raw.strip()
            if not VALID_CONV_ID_RE.match(cand):
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "无效 Codex 会话 ID"})
                return
            conv_id = cand

        codex_bin = _find_codex_bin()
        if not codex_bin:
            self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"ok": False, "error": "未在本机找到 codex 可执行文件"})
            return

        status_info = build_codex_status()
        model_slugs = status_info["modelSlugs"]
        slug_to_display = {v: k for k, v in model_slugs.items()}

        req_model = body.get("model")
        if isinstance(req_model, str) and req_model in model_slugs:
            slug = model_slugs[req_model]
        elif isinstance(req_model, str) and VALID_SLUG_RE.match(req_model.strip()):
            slug = req_model.strip()
        else:
            slug = status_info["defaultModelSlug"]

        display_name = slug_to_display.get(slug, req_model if isinstance(req_model, str) and req_model else slug)

        req_effort = body.get("reasoning")
        effort_args: list[str] = []
        if isinstance(req_effort, str) and req_effort.strip().lower() in VALID_EFFORTS:
            effort_args = ["-c", f'model_reasoning_effort="{req_effort.strip().lower()}"']

        tmp_path: str | None = None
        started = time.perf_counter()
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=".txt") as tmp:
                tmp_path = tmp.name

            if conv_id:
                cmd = [
                    codex_bin,
                    "exec",
                    "resume",
                    "--skip-git-repo-check",
                    "-c",
                    'sandbox_mode="read-only"',
                    "-m",
                    slug,
                    *effort_args,
                    "-o",
                    tmp_path,
                    conv_id,
                    "-",
                ]
            else:
                cmd = [
                    codex_bin,
                    "exec",
                    "--sandbox",
                    "read-only",
                    "--skip-git-repo-check",
                    "--json",
                    "-m",
                    slug,
                    *effort_args,
                    "-C",
                    str(REPO_ROOT),
                    "-o",
                    tmp_path,
                    "-",
                ]

            kwargs = _subprocess_kwargs(120)
            kwargs["input"] = prompt.encode("utf-8")
            kwargs["cwd"] = str(REPO_ROOT)

            proc = subprocess.run(cmd, **kwargs)
            elapsed_ms = int((time.perf_counter() - started) * 1000)

            stdout_text = proc.stdout.decode("utf-8", errors="replace").strip()
            stderr_text = proc.stderr.decode("utf-8", errors="replace").strip()
            out_thread_id, parsed_reply = _parse_codex_json_events(stdout_text)

            reply_text = ""
            if tmp_path and os.path.isfile(tmp_path):
                reply_text = Path(tmp_path).read_text(encoding="utf-8", errors="replace").strip()
            if not reply_text and parsed_reply:
                reply_text = parsed_reply
            if not reply_text and proc.returncode == 0 and stdout_text and not stdout_text.startswith("{"):
                reply_text = stdout_text

            if not reply_text:
                err_msg = stderr_text.splitlines()[-1] if stderr_text else f"codex exec 退出码 {proc.returncode}"
                self._send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": err_msg})
                return

            _cache_turn(conv_id or out_thread_id, prompt, reply_text)

            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "model": display_name,
                    "slug": slug,
                    "conversationId": conv_id or out_thread_id,
                    "resumed": bool(conv_id),
                    "reply": reply_text,
                    "elapsedMs": elapsed_ms,
                },
            )
        except subprocess.TimeoutExpired:
            self._send_json(HTTPStatus.GATEWAY_TIMEOUT, {"ok": False, "error": "Codex 本机响应超时（>120s）"})
        except Exception as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": f"调用 Codex 失败：{exc}"})
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    pass

    def _handle_antigravity_chat(self, body: dict):
        prompt = body.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "请输入要发送给 Antigravity 的内容"})
            return
        prompt = prompt.strip()[:8000]

        mode = body.get("mode")
        mode_str = mode.strip().lower() if isinstance(mode, str) else "local"
        if mode_str not in {"local", "cloud"}:
            mode_str = "local"

        conv_id_raw = body.get("conversationId")
        conv_id: str | None = None
        if isinstance(conv_id_raw, str) and conv_id_raw.strip():
            cand = conv_id_raw.strip()
            if not VALID_CONV_ID_RE.match(cand):
                self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "无效 Antigravity 对话 ID"})
                return
            conv_id = cand

        if conv_id and _is_agy_conversation_active(conv_id):
            self._send_json(
                HTTPStatus.CONFLICT,
                {
                    "ok": False,
                    "error": "该对话正在 Antigravity 桌面端运行中，为避免冲突，请点击「+ 新对话」或选择其它已空闲的最近对话。",
                },
            )
            return

        agy_bin = _find_agy_bin()
        if not agy_bin:
            self._send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"ok": False, "error": "未在本机找到 agy 可执行文件"})
            return

        status_info = build_antigravity_status()
        slug, display_name = _resolve_agy_model(body.get("model"), status_info)

        req_effort = body.get("effort")
        effort = req_effort.strip().lower() if isinstance(req_effort, str) else ""
        if effort not in VALID_AGY_EFFORTS:
            inferred = _infer_effort_from_model(display_name)
            effort = inferred.lower() if inferred else ""

        cmd = [
            agy_bin,
            "--sandbox",
            "--disable-slash-commands",
            "--output-format",
            "json",
            "--model",
            slug,
        ]
        if effort in VALID_AGY_EFFORTS:
            cmd.extend(["--effort", effort])
        if conv_id:
            cmd.extend(["--conversation", conv_id])
        # `-p` 必须作为最后一个参数紧邻 prompt，避免后续 flag 被误认为 prompt。
        cmd.extend(["-p", prompt])

        cloud_tmp_dir: str | None = None
        started = time.perf_counter()
        try:
            if mode_str == "cloud":
                cloud_tmp_dir = tempfile.mkdtemp(prefix="agy-cloud-")
                cwd = cloud_tmp_dir
            else:
                cwd = str(REPO_ROOT)

            kwargs = _subprocess_kwargs(120)
            kwargs["cwd"] = cwd

            proc = subprocess.run(cmd, **kwargs)
            elapsed_ms = int((time.perf_counter() - started) * 1000)

            stdout_text = proc.stdout.decode("utf-8", errors="replace").strip()
            stderr_text = proc.stderr.decode("utf-8", errors="replace").strip()

            json_obj = _extract_json_line(stdout_text)
            if json_obj and json_obj.get("status") == "SUCCESS" and isinstance(json_obj.get("response"), str):
                reply_text = json_obj["response"].strip()
                out_conv_id = json_obj.get("conversation_id") or conv_id
                dur_s = json_obj.get("duration_seconds")
                if isinstance(dur_s, (int, float)) and dur_s > 0:
                    elapsed_ms = int(dur_s * 1000)
            elif proc.returncode == 0 and stdout_text and not json_obj:
                reply_text = stdout_text
                out_conv_id = conv_id
            else:
                err_detail = (
                    (json_obj.get("error") or json_obj.get("message"))
                    if isinstance(json_obj, dict)
                    else None
                )
                err_msg = err_detail or (stderr_text.splitlines()[-1] if stderr_text else f"agy 退出码 {proc.returncode}")
                self._send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": err_msg})
                return

            _cache_turn(out_conv_id, prompt, reply_text)

            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "model": display_name,
                    "slug": slug,
                    "mode": mode_str,
                    "modeLabel": "本地工作区" if mode_str == "local" else "云端对话",
                    "conversationId": out_conv_id,
                    "resumed": bool(conv_id),
                    "reply": reply_text,
                    "elapsedMs": elapsed_ms,
                },
            )
        except subprocess.TimeoutExpired:
            self._send_json(HTTPStatus.GATEWAY_TIMEOUT, {"ok": False, "error": "Antigravity 本机响应超时（>120s）"})
        except Exception as exc:
            self._send_json(HTTPStatus.INTERNAL_SERVER_ERROR, {"ok": False, "error": f"调用 Antigravity 失败：{exc}"})
        finally:
            if cloud_tmp_dir and os.path.exists(cloud_tmp_dir):
                shutil.rmtree(cloud_tmp_dir, ignore_errors=True)


def main():
    parser = argparse.ArgumentParser(description="Serve ai-workstation with local Codex & Antigravity bridges.")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), WorkstationHandler)
    print(f"Serving ai-workstation + Codex & Antigravity bridges on http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
