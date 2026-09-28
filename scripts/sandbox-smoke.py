#!/usr/bin/env python3
"""
Minimal Nebius Token Factory Sandbox connectivity smoke test.

Authenticates with NEBIUS_API_KEY/NEBIUS_PROJECT_ID (from the environment --
see contree_common.py), resolves a small official OCI image, runs
`echo HARNESSLAB_SANDBOX_OK` inside it, and prints the result. Does not run
the coding agent. Makes exactly one real Sandbox operation.
"""
import asyncio
import sys

from contree_common import ConfigError, get_sdk, run_shell

BASE_IMAGE = "node:22-slim"
MARKER = "HARNESSLAB_SANDBOX_OK"


async def main() -> int:
    try:
        sdk = get_sdk()
    except ConfigError as err:
        print(f"Sandbox smoke test FAILED (config): {err}", file=sys.stderr)
        return 1

    print(f"Connecting to Token Factory Sandboxes, base image: {BASE_IMAGE}")
    try:
        result = await run_shell(sdk, BASE_IMAGE, f"echo {MARKER}", disposable=True)
    except Exception as err:  # noqa: BLE001 -- report any SDK/network failure plainly
        print(f"Sandbox smoke test FAILED (operation): {err}", file=sys.stderr)
        return 1

    print(f"exit_code: {result['exit_code']}")
    print(f"stdout: {result['stdout']!r}")
    print(f"stderr: {result['stderr']!r}")
    print(f"image/checkpoint uuid: {result['uuid']}")

    if result["exit_code"] != 0 or MARKER not in (result["stdout"] or ""):
        print("Sandbox smoke test FAILED: marker not found in stdout", file=sys.stderr)
        return 1

    print(MARKER)
    print("Sandbox smoke test PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
