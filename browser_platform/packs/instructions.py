from __future__ import annotations


def parse_instructions(markdown: str) -> dict:
    summary = [
        line[2:].strip()
        for line in markdown.split('\n')
        if line.strip().startswith('- ')
        and line.strip()[2:].strip()
    ]
    return {'summary': summary, 'raw': markdown}
