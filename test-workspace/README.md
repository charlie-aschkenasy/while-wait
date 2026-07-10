# Standby test workspace

This folder is opened by the Extension Development Host (F5). It exists because
VS Code/Cursor won't open the `while-wait` folder itself in the dev host while
it's already open in the main window.

Test the lifecycle from the main window's terminal with:

```sh
scripts/fake-agent.sh "$PWD/test-workspace"
```

or run a real Claude Code session in the dev host's terminal (its cwd is this
folder, so events match the workspace).
