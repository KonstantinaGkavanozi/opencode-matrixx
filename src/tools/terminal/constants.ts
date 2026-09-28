export const TERMINAL_DESCRIPTION = `Manage native interactive terminals (ConPTY on Windows, PTY on Unix).
Operations: create, list, write, read, snapshot, resize, interrupt, close, viewer.
Create uses executable + args, not a shell command string. Supply an absolute cwd when needed.
Write sends literal input; include \r for Enter on Windows. Read uses byte cursors and reports truncation.
Snapshot interprets terminal escape sequences for TUI screen inspection. Process exit is not the exit status of each command entered into a persistent shell.
Use this tool instead of tmux/interactive_bash on native Windows. Ordinary one-shot commands should still use bash.
Viewer returns a private local URL granting human control of this session's terminals. Do not share or log it.
Sessions end with this OpenCode instance; restart persistence is not supported.`
