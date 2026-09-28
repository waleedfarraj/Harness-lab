#!/usr/bin/env python3
"""
Milestone 3.5 branching spike: proves Sandbox branching gives isolated
filesystem state, using only the documented pattern (call run(...,
disposable=False) more than once from the SAME parent image/checkpoint).
Does not touch HarnessLab's experiment layer. Makes three real Sandbox
operations (base, branch A, branch B) plus four read-only verification
operations.
"""
import asyncio
import sys

from contree_common import ConfigError, get_sdk, run_shell

BASE_IMAGE = "node:22-slim"


async def read_file(sdk, checkpoint: str, path: str):
    result = await run_shell(sdk, checkpoint, f"cat {path} 2>/dev/null || echo __MISSING__", disposable=True)
    stdout = (result["stdout"] or "").strip()
    return None if stdout == "__MISSING__" or stdout == "" else stdout


async def main() -> int:
    try:
        sdk = get_sdk()
    except ConfigError as err:
        print(f"Branch spike FAILED (config): {err}", file=sys.stderr)
        return 1

    print(f"Base image: {BASE_IMAGE}")
    try:
        base = await run_shell(sdk, BASE_IMAGE, "echo base > base.txt", disposable=False)
        base_checkpoint = base["uuid"]
        print(f"Base checkpoint: {base_checkpoint}")

        # Two independent children of the SAME base checkpoint -- a fork, not a chain.
        branch_a = await run_shell(sdk, base_checkpoint, "echo A > marker-a.txt", disposable=False)
        branch_b = await run_shell(sdk, base_checkpoint, "echo B > marker-b.txt", disposable=False)
        checkpoint_a, checkpoint_b = branch_a["uuid"], branch_b["uuid"]
        print(f"Branch A checkpoint: {checkpoint_a}")
        print(f"Branch B checkpoint: {checkpoint_b}")

        a_has_a = await read_file(sdk, checkpoint_a, "marker-a.txt")
        a_has_b = await read_file(sdk, checkpoint_a, "marker-b.txt")
        b_has_a = await read_file(sdk, checkpoint_b, "marker-a.txt")
        b_has_b = await read_file(sdk, checkpoint_b, "marker-b.txt")
    except Exception as err:  # noqa: BLE001 -- always report plainly, never a raw traceback
        print(f"Branch spike FAILED (operation): {err}", file=sys.stderr)
        return 1

    print(f"Branch A: marker-a.txt={a_has_a!r} marker-b.txt={a_has_b!r}")
    print(f"Branch B: marker-a.txt={b_has_a!r} marker-b.txt={b_has_b!r}")

    isolated = a_has_a is not None and a_has_b is None and b_has_b is not None and b_has_a is None
    if not isolated:
        print("Branch spike FAILED: branches are not isolated from each other", file=sys.stderr)
        return 1

    print("Branch spike PASSED: A's change is absent from B, B's change is absent from A")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
