# LitRes login notes

MVP0 scope does not implement the full Sber ID or LitRes login flow inside browser-platform.

Operational expectation for now:

- prefer reusing an externally prepared authenticated browser state in a later commit
- if the session appears anonymous or hits a login gate, report that state clearly
- do not attempt risky auth automation beyond simple observation in this commit
