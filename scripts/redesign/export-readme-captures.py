"""Export verified Electron PNG captures as README WebP files (requires Pillow).

Usage: python scripts/redesign/export-readme-captures.py .runtime/rebrand-v0.0.1
"""
import hashlib
import json
from pathlib import Path
import sys

from PIL import Image

root = Path(__file__).resolve().parents[2]
captures = root / sys.argv[1]
output = root / "docs/assets/readme"
output.mkdir(parents=True, exist_ok=True)
records = []


def export(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as image:
        size = list(image.size)
        image.save(target, "WEBP", quality=92, method=6)
    records.append({"source": str(source.relative_to(captures)).replace("\\", "/"),
                    "file": str(target.relative_to(root)).replace("\\", "/"),
                    "size": size, "sha256": hashlib.sha256(target.read_bytes()).hexdigest()})


sessions = []
for locale in ("zh", "en"):
    for suffix, directory in (("light", captures / f"screens-{locale}"),
                              ("dark", captures / f"readme-{locale}-dark"),
                              ("hero", captures / f"readme-hero-{locale}-light")):
        results = list(directory.glob("readme-*.json"))
        if len(results) != 1:
            raise RuntimeError(f"Missing unique capture result: {directory}")
        result = json.loads(results[0].read_text(encoding="utf-8"))[0]
        if any(result.get(key) for key in ("error", "externalRequests", "residualProcesses", "externalWrites")):
            raise RuntimeError(f"Capture did not pass isolation checks: {directory}")
        sessions.append({"scenario": result["scenario"], "theme": result["theme"],
                         "timing": result["timing"], "model": "local fixture",
                         "externalRequests": [], "residualProcesses": [], "externalWrites": []})
        if suffix == "light":
            for scene in ("library", "chapter", "blueprint", "run", "architecture", "cast"):
                export(directory / f"v001-{locale}-{scene}-light.png", output / f"v001-{locale}-{scene}.webp")
        elif suffix == "dark":
            export(directory / f"v001-{locale}-chapter-dark.png", output / f"v001-{locale}-chapter-dark.webp")
        else:
            for index, scene in enumerate(("library", "chapter", "blueprint", "run", "architecture", "cast"), 1):
                export(directory / f"hero-{locale}-{scene}-light.png",
                       output / f"hero-captures/v001/{locale}/{index:02}-{scene}.webp")

(root / "docs/readme-visuals/captures-v0.0.1.json").write_text(
    json.dumps({"version": "0.0.1", "sessions": sessions, "captures": records}, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8")
print(f"Exported {len(records)} fresh desktop captures")
