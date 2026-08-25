# Codex Quota Float

A compact floating Codex quota monitor for Windows.

![Codex Quota Float preview](assets/preview-expanded.png)

## Features

- Five-hour quota displayed as a blue inner ring
- Weekly quota displayed as a purple outer ring
- Separate remaining percentages divided by a white rule
- Compact countdown and absolute reset-time display
- Always-on-top floating panel with manual refresh and reset controls

## Development

Install dependencies:

```powershell
pnpm install
```

Run tests:

```powershell
pnpm test
```

Build the portable Windows executable:

```powershell
pnpm build
```

The executable is generated at `release/Codex Quota Float.exe`.
