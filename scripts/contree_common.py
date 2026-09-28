"""
Shared helpers for talking to Nebius Token Factory Sandboxes (the Contree
Python SDK). Used by sandbox-smoke.py, contree-bridge.py, and
sandbox-branch-spike.py so the client/auth wiring lives in exactly one place.

The SDK construction below is verified against the ACTUALLY INSTALLED
contree-sdk (0.3.6) via direct introspection (inspect.signature /
inspect.getsource), not just documentation, because the docs and the
installed package disagreed on a couple of points:
  - contree_sdk.Contree(config=ContreeConfig(auth=IAMAuth(...))) is the real
    constructor path with project scoping; there is no `project=` kwarg on
    Contree itself, only on IAMAuth.
  - IAMAuth(base_url=..., token=..., project_id=...) is where
    NEBIUS_API_KEY / NEBIUS_PROJECT_ID actually go. Confirmed: IAMAuth does
    NOT read the environment itself -- its parameter defaults just happen to
    be named after the env vars callers are expected to read and pass in.
  - sdk.images.use(tag) -> lazy image reference, no API call
  - image.run(shell=..., env=..., disposable=...) -> awaitable, returns an
    object with .stdout / .stderr / .exit_code / .uuid (confirmed via
    contree_sdk/sdk/objects/image_like/_base.py).

Credentials are read from THIS process's own environment only. Sandbox
commands never receive NEBIUS_API_KEY or NEBIUS_PROJECT_ID -- see the `env`
argument on run_shell(), which is exactly what a command receives.
"""
import json
import os
import sys

DEFAULT_BASE_URL = "https://api.tokenfactory.nebius.com/sandboxes"


class ConfigError(Exception):
    pass


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigError(f"{name} is not set")
    return value


def get_sdk():
    """Builds a Contree async SDK instance. Raises ConfigError if credentials are missing."""
    from contree_sdk import Contree
    from contree_sdk.config import ContreeConfig, IAMAuth

    api_key = require_env("NEBIUS_API_KEY")
    project_id = require_env("NEBIUS_PROJECT_ID")
    base_url = os.environ.get("NEBIUS_SANDBOX_BASE_URL", "").strip() or DEFAULT_BASE_URL

    auth = IAMAuth(base_url=base_url, token=api_key, project_id=project_id)
    return Contree(config=ContreeConfig(auth=auth))


async def run_shell(sdk, image_ref: str, shell: str, env: dict | None = None, disposable: bool = True):
    """
    The one primitive everything else is built on: resolve `image_ref` (a base
    image tag like "node:22-slim", or a checkpoint UUID from a previous call),
    run one shell command in it, and return the result.

    disposable=False persists the resulting filesystem state as a new
    addressable image version (result.uuid) -- this doubles as "checkpoint" /
    "commit". disposable=True (the default) is for read-only operations that
    shouldn't create a new version.

    Uses images.docker() rather than images.use(): confirmed via a real
    smoke-test call that use() 404s on a tag Token Factory hasn't already
    registered (e.g. a public "node:22-slim" it's never pulled before).
    docker() resolves-by-tag-with-import-fallback for a registry tag, and
    resolves directly for a UUID (a prior call's checkpoint) -- one method
    correctly covers both cases we actually use.

    Every command runs inside /workspace, not the image's filesystem root.
    Confirmed via a real run: without this, `git add -A` at "/" tried to
    stat container /proc entries (a transient process's fd disappeared
    mid-scan) and failed outright -- operating at root isn't just messy,
    it's actively broken for git.
    """
    image = await sdk.images.docker(image_ref)
    scoped_shell = f"mkdir -p /workspace && cd /workspace && {shell}"
    result = await image.run(shell=scoped_shell, env=env or {}, disposable=disposable)
    uuid = getattr(result, "uuid", None)
    return {
        "stdout": result.stdout,
        "stderr": result.stderr,
        "exit_code": result.exit_code,
        "uuid": str(uuid) if uuid is not None else None,
    }


def read_json_request() -> dict:
    raw = sys.stdin.read()
    try:
        return json.loads(raw)
    except json.JSONDecodeError as err:
        write_json_response({"ok": False, "error": f"invalid JSON on stdin: {err}"})
        sys.exit(1)


def write_json_response(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj))
    sys.stdout.write("\n")
    sys.stdout.flush()
