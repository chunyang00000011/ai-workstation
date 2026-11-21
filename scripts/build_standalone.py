"""Build a self-contained single-file HTML bundle for Muse Space / static hosting.

Reads `index.html`, `config/models.json`, `vendor/three-r160-bundle.min.js`,
`src/labels.js`, `src/boss.js`, and `src/app.js`, strips external Google Fonts
links and `<script type="importmap">`, embeds Three.js r160 and the ES modules
into `dist/ai-workstation-standalone.html`, isolates the snapshot config JSON in
`#snapshot-config`, and guards `/api/*` bridge probes to localhost only so
embedded sandboxes produce zero external requests or 404 console noise.
"""

from __future__ import annotations

import json
from pathlib import Path
import re

REPO_ROOT = Path(__file__).resolve().parent.parent
VENDOR_THREE_PATH = REPO_ROOT / "vendor" / "three-r160-bundle.min.js"
OUT_PATH = REPO_ROOT / "dist" / "ai-workstation-standalone.html"

GOOGLE_FONTS_BLOCK = """<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">\n"""


def _strip_imports_and_export(source: str) -> str:
    out_lines: list[str] = []
    in_import = False
    for line in source.splitlines():
        stripped = line.strip()
        if not in_import and stripped.startswith("import "):
            if "from " in stripped or stripped.endswith(";"):
                continue
            in_import = True
            continue
        if in_import:
            if "from " in stripped or stripped.endswith(";"):
                in_import = False
            continue
        line = re.sub(r"^export\s+(?=(const|function|async function|class)\b)", "", line)
        out_lines.append(line)
    return "\n".join(out_lines).strip()


def _strip_external_head_deps(index_html: str) -> str:
    if GOOGLE_FONTS_BLOCK not in index_html:
        raise RuntimeError("Could not find expected Google Fonts <link> block in index.html")
    html = index_html.replace(GOOGLE_FONTS_BLOCK, "", 1)

    html, importmap_count = re.subn(
        r'\n?<script type="importmap">[\s\S]*?</script>\n?',
        "\n",
        html,
        count=1,
    )
    if importmap_count != 1:
        raise RuntimeError(f"Expected 1 importmap block in index.html, removed {importmap_count}")
    return html


def _inline_app_js(app_src: str) -> str:
    stripped = _strip_imports_and_export(app_src)

    old_load_config = """async function loadConfig() {
  try {
    const res = await fetch('./config/models.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json && Array.isArray(json.agents)) state.config = json;
  } catch (err) {
    document.getElementById('config-note').hidden = false;
    console.warn('config/models.json 加载失败，使用离线快照', err);
  }
  for (const agent of state.config.agents) {
    state.selectedModels[agent.id] = agent.defaultModel;
  }
}"""

    new_load_config = """async function loadConfig() {
  if (INLINE_CONFIG && Array.isArray(INLINE_CONFIG.agents)) {
    state.config = INLINE_CONFIG;
  }
  for (const agent of state.config.agents) {
    state.selectedModels[agent.id] = agent.defaultModel;
  }
}"""

    if old_load_config not in stripped:
        raise RuntimeError("Could not find expected loadConfig() block in src/app.js")
    stripped = stripped.replace(old_load_config, new_load_config, 1)

    local_guard = (
        "const IS_LOCAL_HOST = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);\n\n"
    )
    codex_target = "async function loadCodexBridgeStatus() {\n  try {"
    if codex_target not in stripped:
        raise RuntimeError("Could not find loadCodexBridgeStatus() in src/app.js")
    stripped = stripped.replace(
        codex_target,
        f"{local_guard}async function loadCodexBridgeStatus() {{\n  if (!IS_LOCAL_HOST) return;\n  try {{",
        1,
    )

    agy_target = "async function loadAntigravityBridgeStatus() {\n  try {"
    if agy_target not in stripped:
        raise RuntimeError("Could not find loadAntigravityBridgeStatus() in src/app.js")
    stripped = stripped.replace(
        agy_target,
        "async function loadAntigravityBridgeStatus() {\n  if (!IS_LOCAL_HOST) return;\n  try {",
        1,
    )

    dom_ready_main = """\nif (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { main(); }, { once: true });
} else {
  main();
}"""
    stripped, main_count = re.subn(r"\nmain\(\);\s*$", lambda _: dom_ready_main, stripped, count=1)
    if main_count != 1:
        raise RuntimeError(f"Expected 1 trailing main(); call in src/app.js, replaced {main_count}")

    return stripped


def _verify_standalone_html(html: str, cfg_json: str, vendor_three_js: str, app_bundle_js: str) -> None:
    if "</script" in cfg_json.lower():
        raise ValueError("Snapshot config contains unsafe '</script' sequence")
    if "</script" in vendor_three_js.lower():
        raise ValueError("Vendor Three.js bundle contains unsafe '</script' sequence")
    if "</script" in app_bundle_js.lower():
        raise ValueError("Bundled app JS contains unsafe '</script' sequence")

    forbidden = [
        "cdn.jsdelivr.net",
        "fonts.googleapis.com",
        "fonts.gstatic.com",
        'type="importmap"',
    ]
    for marker in forbidden:
        if marker in html:
            raise AssertionError(f"Standalone HTML must not contain {marker!r}")

    required = [
        "SNAPSHOT_CONFIG_START",
        "SNAPSHOT_CONFIG_END",
        'id="snapshot-config"',
        'id="three-r160-bundle"',
        'id="ai-workstation-app"',
        "IS_LOCAL_HOST",
        "Orchestrator Gemini 4 Neon Extra High",
        "状态快照（非持续同步）",
    ]
    for marker in required:
        if marker not in html:
            raise AssertionError(f"Standalone HTML missing required marker {marker!r}")


def build() -> Path:
    if not VENDOR_THREE_PATH.is_file():
        raise FileNotFoundError(f"Missing vendored Three.js bundle: {VENDOR_THREE_PATH}")

    index_html = _strip_external_head_deps((REPO_ROOT / "index.html").read_text(encoding="utf-8"))
    cfg_raw = (REPO_ROOT / "config" / "models.json").read_text(encoding="utf-8")
    cfg_json = json.dumps(json.loads(cfg_raw), ensure_ascii=False, indent=2).replace("</", r"<\/")
    vendor_three_js = VENDOR_THREE_PATH.read_text(encoding="utf-8").strip()

    labels_js = _strip_imports_and_export((REPO_ROOT / "src" / "labels.js").read_text(encoding="utf-8"))
    boss_js = _strip_imports_and_export((REPO_ROOT / "src" / "boss.js").read_text(encoding="utf-8"))
    app_js = _inline_app_js((REPO_ROOT / "src" / "app.js").read_text(encoding="utf-8"))

    app_bundle_js = "\n\n".join(
        [
            "(() => {",
            "'use strict';",
            "const { THREE, OrbitControls, CSS2DRenderer, CSS2DObject, RoomEnvironment } = globalThis.__AI_WORKSTATION_THREE__;",
            "const INLINE_CONFIG = JSON.parse(document.getElementById('snapshot-config')?.textContent || 'null');",
            "// --- inlined from src/labels.js ---",
            labels_js,
            "// --- inlined from src/boss.js ---",
            boss_js,
            "// --- inlined from src/app.js ---",
            app_js,
            "})();",
        ]
    )

    replacement = "\n".join(
        [
            "<!-- SNAPSHOT_CONFIG_START: Muse 状态快照同步区（仅修改此 JSON 即可更新工位状态、模型与当前任务，无需改动下方 3D 引擎代码） -->",
            '<script id="snapshot-config" type="application/json">',
            cfg_json,
            "</script>",
            "<!-- SNAPSHOT_CONFIG_END -->",
            '<script id="three-r160-bundle">',
            vendor_three_js,
            "</script>",
            '<script id="ai-workstation-app">',
            app_bundle_js,
            "</script>",
        ]
    )

    script_tag = '<script type="module" src="./src/app.js"></script>'
    if script_tag not in index_html:
        raise RuntimeError(f"Expected {script_tag!r} in index.html")

    standalone_html = index_html.replace(script_tag, replacement, 1)
    _verify_standalone_html(standalone_html, cfg_json, vendor_three_js, app_bundle_js)

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(standalone_html, encoding="utf-8")
    return OUT_PATH


if __name__ == "__main__":
    out = build()
    print(f"Built {out} ({out.stat().st_size} bytes)")
