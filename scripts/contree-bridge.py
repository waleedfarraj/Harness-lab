#!/usr/bin/env python3
"""
JSON stdin/stdout bridge between HarnessLab's TypeScript TokenFactorySandboxRunner
and the Contree Python SDK. One request in, one response out, then exit --
no long-running daemon, no terminal-output scraping.

Every operation is built on `run_shell()` (see contree_common.py), which
wraps the one solidly-documented primitive: image.run(shell=..., env=...) ->
stdout/stderr/exit_code/uuid. Contree's "state" is a checkpoint/image UUID,
not a filesystem path, so every operation here takes the CURRENT checkpoint
as input and returns the NEW checkpoint as output; the TypeScript side is
responsible for threading that UUID from call to call for one experiment.

Request:  {"op": "create"|"execute"|"read_file"|"write_file"|"list_files"|"destroy", ...}
Response: {"ok": true, ...} | {"ok": false, "error": "..."}

Credentials come only from THIS process's environment (see contree_common.py).
Nothing in the request or response ever carries NEBIUS_API_KEY.
"""
import asyncio
import shlex
import sys

from contree_common import ConfigError, get_sdk, read_json_request, run_shell, write_json_response


async def run_with_optional_timeout(sdk, checkpoint: str, shell: str, env: dict, disposable: bool, timeout):
    """Passes `timeout` through if the SDK's run() accepts it; degrades gracefully if not documented/supported."""
    image = await sdk.images.docker(checkpoint)
    scoped_shell = f"mkdir -p /workspace && cd /workspace && {shell}"
    kwargs = {"shell": scoped_shell, "env": env, "disposable": disposable}
    if timeout is not None:
        kwargs["timeout"] = timeout
    try:
        result = await image.run(**kwargs)
    except TypeError:
        kwargs.pop("timeout", None)
        result = await image.run(**kwargs)
    uuid = getattr(result, "uuid", None)
    return {"stdout": result.stdout, "stderr": result.stderr, "exit_code": result.exit_code, "uuid": str(uuid) if uuid is not None else None}


def build_create_script(files: dict) -> tuple[str, dict]:
    """
    One shell script that writes every fixture file, installs its declared
    devDependencies (there is no local node_modules to symlink from out
    here, unlike LocalExperimentRunner), and commits the result as the
    starting git state -- all in a single remote call.
    """
    env = {}
    lines = ["set -e"]
    for i, (rel_path, content) in enumerate(files.items()):
        var = f"HARNESSLAB_FILE_{i}"
        env[var] = content
        quoted_path = shlex.quote(rel_path)
        lines.append(f'mkdir -p "$(dirname {quoted_path})"')
        lines.append(f'printf "%s" "${var}" > {quoted_path}')
    lines.append("printf 'node_modules\\n' > .gitignore")
    if "package.json" in files:
        lines.append("npm install --no-audit --no-fund --silent")
    # node:22-slim has no git; installed for parity with the local runner's git-based
    # diff evidence (git_diff tool, evaluator's raw diff) -- the one apt install this
    # fixture genuinely needs, not a default habit.
    lines.append("command -v git >/dev/null || (apt-get update -qq && apt-get install -y -qq --no-install-recommends git)")
    lines.append("git init -q")
    lines.append("git add -A")
    lines.append('git -c user.email=harnesslab@remote -c user.name=HarnessLab commit -q -m "canonical fixture state"')
    return "\n".join(lines), env


async def handle(request: dict) -> dict:
    op = request.get("op")
    sdk = get_sdk()

    if op == "create":
        base_image = request["base_image"]
        files = request.get("files", {})
        script, env = build_create_script(files)
        result = await run_with_optional_timeout(sdk, base_image, script, env, disposable=False, timeout=None)
        if result["exit_code"] != 0:
            return {"ok": False, "error": f"create failed (exit {result['exit_code']}): {result['stderr']}"}
        return {"ok": True, "checkpoint": result["uuid"], "baseImage": base_image}

    if op == "execute":
        result = await run_with_optional_timeout(
            sdk, request["checkpoint"], request["command"], request.get("env", {}), disposable=False, timeout=request.get("timeout")
        )
        return {
            "ok": True,
            "checkpoint": result["uuid"],
            "stdout": result["stdout"],
            "stderr": result["stderr"],
            "exitCode": result["exit_code"],
        }

    if op == "read_file":
        quoted = shlex.quote(request["path"])
        result = await run_shell(sdk, request["checkpoint"], f"cat {quoted}", disposable=True)
        if result["exit_code"] != 0:
            return {"ok": False, "error": f"file not found: {request['path']}"}
        return {"ok": True, "content": result["stdout"]}

    if op == "write_file":
        quoted = shlex.quote(request["path"])
        script = f'mkdir -p "$(dirname {quoted})"\nprintf "%s" "$HARNESSLAB_CONTENT" > {quoted}'
        result = await run_shell(sdk, request["checkpoint"], script, env={"HARNESSLAB_CONTENT": request["content"]}, disposable=False)
        if result["exit_code"] != 0:
            return {"ok": False, "error": f"write failed (exit {result['exit_code']}): {result['stderr']}"}
        return {"ok": True, "checkpoint": result["uuid"]}

    if op == "list_files":
        directory = request.get("dir", ".")
        quoted = shlex.quote(directory)
        script = f"cd {quoted} && find . -type f -not -path './node_modules/*' -not -path './.git/*' | sed 's#^\\./##'"
        result = await run_shell(sdk, request["checkpoint"], script, disposable=True)
        if result["exit_code"] != 0:
            return {"ok": False, "error": f"list failed (exit {result['exit_code']}): {result['stderr']}"}
        files = [line for line in (result["stdout"] or "").splitlines() if line.strip()]
        return {"ok": True, "files": sorted(files)}

    if op == "destroy":
        # The documented Contree API (verified: getting-started, running-commands, images,
        # branching, files, session, client, subprocess reference pages) exposes no explicit
        # image/checkpoint delete method. This is a deliberate no-op, not a fabricated cleanup.
        return {"ok": True, "note": "no documented delete operation; relying on Nebius's own image lifecycle"}

    return {"ok": False, "error": f"unknown op: {op}"}


async def main() -> int:
    request = read_json_request()
    try:
        response = await handle(request)
    except ConfigError as err:
        write_json_response({"ok": False, "error": f"config error: {err}"})
        return 1
    except Exception as err:  # noqa: BLE001 -- always report as structured JSON, never a raw traceback on stdout
        write_json_response({"ok": False, "error": f"{type(err).__name__}: {err}"})
        return 1
    write_json_response(response)
    return 0 if response.get("ok") else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
