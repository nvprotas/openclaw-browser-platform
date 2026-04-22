import asyncio
import sys
from browser_platform.cli.main import run_cli

if __name__ == '__main__':
    sys.exit(asyncio.run(run_cli(sys.argv[1:])))
