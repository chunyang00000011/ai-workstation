"""Build a faithful standalone single-file HTML bundle for Muse Space / static hosting.

Reads `index.html`, `config/models.json`, `src/labels.js`, `src/boss.js`, and
`src/app.js` verbatim, inlines the ES modules and config snapshot into
`dist/ai-workstation-standalone.html`, and guards `/api/*` bridge probes to
localhost only so embedded sandboxes produce zero 404 console noise.
"""

from __future__ import annotations

import json
from pathlib import Path
import re

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT_PATH = REPO_ROOT / "dist" / "ai-workstation-standalone.html"

MERGED_IMPORTS = """import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';"""


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


def _inline_app_js(app_src: str, cfg_json: str) -> str:
    # Strip top import block from app.js up to the first blank line after imports.
    stripped = _strip_imports_and_export(app_src)

    # Inject INLINE_CONFIG and update loadConfig() to use it without network fetch.
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

    new_load_config = f"""const INLINE_CONFIG = {cfg_json};

async function loadConfig() {{
  if (INLINE_CONFIG && Array.isArray(INLINE_CONFIG.agents)) {{
    state.config = INLINE_CONFIG;
  }}
  for (const agent of state.config.agents) {{
    state.selectedModels[agent.id] = agent.defaultModel;
  }}
}}"""

    if old_load_config not in stripped:
        raise RuntimeError("Could not find expected loadConfig() block in src/app.js")
    stripped = stripped.replace(old_load_config, new_load_config, 1)

    # Guard local CLI bridge probes so embedded non-localhost sandboxes skip /api/* cleanly.
    local_guard = (
        "const IS_LOCAL_HOST = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);\n\n"
    )
    stripped = stripped.replace(
        "async function loadCodexBridgeStatus() {\n  try {",
        f"{local_guard}async function loadCodexBridgeStatus() {{\n  if (!IS_LOCAL_HOST) return;\n  try {{",
        1,
    )
    stripped = stripped.replace(
        "async function loadAntigravityBridgeStatus() {\n  try {",
        "async function loadAntigravityBridgeStatus() {\n  if (!IS_LOCAL_HOST) return;\n  try {",
        1,
    )
    return stripped


def build() -> Path:
    index_html = (REPO_ROOT / "index.html").read_text(encoding="utf-8")
    cfg_raw = (REPO_ROOT / "config" / "models.json").read_text(encoding="utf-8")
    # Re-serialize cleanly to guarantee valid compact JSON literal inside <script>.
    cfg_json = json.dumps(json.loads(cfg_raw), ensure_ascii=False, indent=2)

    labels_js = _strip_imports_and_export((REPO_ROOT / "src" / "labels.js").read_text(encoding="utf-8"))
    boss_js = _strip_imports_and_export((REPO_ROOT / "src" / "boss.js").read_text(encoding="utf-8"))
    app_js = _inline_app_js((REPO_ROOT / "src" / "app.js").read_text(encoding="utf-8"), cfg_json)

    bundled_js = "\n\n".join(
        [
            MERGED_IMPORTS,
            "// --- inlined from src/labels.js ---",
            labels_js,
            "// --- inlined from src/boss.js ---",
            boss_js,
            "// --- inlined from src/app.js ---",
            app_js,
        ]
    )

    # Escape any accidental closing script sequence in string literals if ever added later.
    if "</script" in bundled_js.lower():
        raise ValueError("Bundled JS contains unsafe '</script' sequence")

    script_tag = '<script type="module" src="./src/app.js"></script>'
    if script_tag not in index_html:
        raise RuntimeError(f"Expected {script_tag!r} in index.html")

    standalone_html = index_html.replace(
        script_tag,
        f'<script type="module">\n{bundled_js}\n</script>',
        1,
    )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(standalone_html, encoding="utf-8")
    return OUT_PATH


if __name__ == "__main__":
    out = build()
    print(f"Built {out} ({out.stat().st_size} bytes)")
