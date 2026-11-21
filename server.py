"""Local Codex CLI bridge and static server for ai-workstation.

Serves static files from the repository directory on 127.0.0.1 and exposes:
- GET  /api/codex/status  Reads non-secret local Codex config/model cache/session summary.
- POST /api/codex/chat    Runs `codex exec --sandbox read-only --ephemeral` locally.
"""

from __future__ import annotations

import argparse
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import tomllib
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parent
CODEX_HOME = Path.home() / ".codex"
VALID_SLUG_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
VALID_EFFORTS = {"low", "medium", "high", "xhigh", "max"}
MAX_BODY_BYTES = 32 * 1024

_CLI_VERSION_CACHE: dict[str, str | None] = {"bin": None, "version": None}


def _find_codex_bin() -> str | None:
    return shutil.which("codex.cmd") or shutil.which("codex")


def _get_cli_version(codex_bin: str | None) -> str | None:
    if not codex_bin:
        return None
    if _CLI_VERSION_CACHE["bin"] == codex_bin and _CLI_VERSION_CACHE["version"]:
        return _CLI_VERSION_CACHE["version"]
    try:
        kwargs: dict = {"capture_output": True, "timeout": 10}
        if os.name == "nt":
            kwargs["creationflags"] = 0x08000000
        proc = subprocess.run([codex_bin, "--version"], **kwargs)
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


def _read_latest_session() -> dict[str, str] | None:
    sessions_dir = CODEX_HOME / "sessions"
    if not sessions_dir.is_dir():
        return None
    newest_path: Path | None = None
    newest_mtime = -1.0
    try:
        for path in sessions_dir.rglob("*.jsonl"):
            try:
                mtime = path.stat().st_mtime
            except OSError:
                continue
            if mtime > newest_mtime:
                newest_mtime = mtime
                newest_path = path
    except Exception:
        return None

    if newest_path is None:
        return None

    project = "workspace"
    ts_str = datetime.fromtimestamp(newest_mtime).strftime("%Y-%m-%d %H:%M")
    try:
        with newest_path.open("r", encoding="utf-8", errors="replace") as fh:
            first_line = fh.readline()
        if first_line:
            meta = json.loads(first_line)
            payload = meta.get("payload") if isinstance(meta.get("payload"), dict) else {}
            cwd = payload.get("cwd")
            if isinstance(cwd, str) and cwd.strip():
                base = Path(cwd.strip()).name
                if base:
                    project = base
            raw_ts = meta.get("timestamp") or payload.get("timestamp")
            if isinstance(raw_ts, str):
                try:
                    dt = datetime.fromisoformat(raw_ts.replace("Z", "+00:00")).astimezone()
                    ts_str = dt.strftime("%Y-%m-%d %H:%M")
                except ValueError:
                    pass
    except Exception:
        pass
    return {"time": ts_str, "project": project}


def build_codex_status() -> dict:
    codex_bin = _find_codex_bin()
    cli_version = _get_cli_version(codex_bin)
    cfg_slug, effort = _read_config_defaults()
    models, model_slugs, slug_to_display, fetched_at = _read_models_cache()

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
        "latestSession": _read_latest_session(),
    }


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

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/codex/status":
            self._send_json(HTTPStatus.OK, build_codex_status())
            return

        rel_parts = [p for p in Path(parsed.path).parts if p not in {"/", "\\"}]
        if any(part.startswith(".") for part in rel_parts):
            self.send_error(HTTPStatus.FORBIDDEN, "Forbidden")
            return

        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/codex/chat":
            self.send_error(HTTPStatus.NOT_FOUND, "Not Found")
            return

        if not _is_localhost_host(self.headers.get("Host")) or not _is_localhost_origin(
            self.headers.get("Origin")
        ):
            self._send_json(HTTPStatus.FORBIDDEN, {"ok": False, "error": "只允许本地来源访问 Codex 桥接接口"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "无效请求长度"})
            return

        if length <= 0 or length > MAX_BODY_BYTES:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "请求内容为空或超出 32KB 上限"})
            return

        try:
            raw = self.rfile.read(length)
            body = json.loads(raw.decode("utf-8"))
        except Exception:
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "请求 JSON 格式错误"})
            return

        prompt = body.get("prompt")
        if not isinstance(prompt, str) or not prompt.strip():
            self._send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "请输入要发送给 Codex 的内容"})
            return
        prompt = prompt.strip()[:8000]

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

            cmd = [
                codex_bin,
                "exec",
                "--sandbox",
                "read-only",
                "--ephemeral",
                "--skip-git-repo-check",
                "--color",
                "never",
                "-m",
                slug,
                *effort_args,
                "-C",
                str(REPO_ROOT),
                "-o",
                tmp_path,
                "-",
            ]
            kwargs: dict = {
                "input": prompt.encode("utf-8"),
                "capture_output": True,
                "timeout": 120,
            }
            if os.name == "nt":
                kwargs["creationflags"] = 0x08000000

            proc = subprocess.run(cmd, **kwargs)
            elapsed_ms = int((time.perf_counter() - started) * 1000)

            reply_text = ""
            if tmp_path and os.path.isfile(tmp_path):
                reply_text = Path(tmp_path).read_text(encoding="utf-8", errors="replace").strip()

            if not reply_text:
                stdout_text = proc.stdout.decode("utf-8", errors="replace").strip()
                stderr_text = proc.stderr.decode("utf-8", errors="replace").strip()
                if proc.returncode == 0 and stdout_text:
                    reply_text = stdout_text
                else:
                    err_msg = stderr_text.splitlines()[-1] if stderr_text else f"codex exec 退出码 {proc.returncode}"
                    self._send_json(HTTPStatus.BAD_GATEWAY, {"ok": False, "error": err_msg})
                    return

            self._send_json(
                HTTPStatus.OK,
                {
                    "ok": True,
                    "model": display_name,
                    "slug": slug,
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


def main():
    parser = argparse.ArgumentParser(description="Serve ai-workstation with local Codex CLI bridge.")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", args.port), WorkstationHandler)
    print(f"Serving ai-workstation + Codex bridge on http://127.0.0.1:{args.port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
