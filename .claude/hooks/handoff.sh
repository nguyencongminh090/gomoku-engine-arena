#!/usr/bin/env bash
# UserPromptSubmit hook: session handoff via memory.
#   "handoff:save"   -> tell the agent to write the session state to memory + print a one-sentence resume trigger
#   "handoff:resume" -> inject the saved handoff memory so a new conversation continues from it
prompt=$(jq -r '.prompt // ""')
proj="${CLAUDE_PROJECT_DIR:-$PWD}"
mem="$HOME/.claude/projects/$(printf '%s' "$proj" | sed 's/[^A-Za-z0-9]/-/g')/memory"
file="$mem/session-handoff.md"

emit() { jq -n --arg c "$1" '{hookSpecificOutput:{hookEventName:"UserPromptSubmit",additionalContext:$c}}'; }

shopt -s nocasematch
if [[ "$prompt" == *handoff:save* ]]; then
  emit "HANDOFF SAVE requested. Do this now, then reply in Vietnamese:
1. Write (overwrite) $file as a memory file with frontmatter (name: session-handoff, description: latest session state for resuming, metadata.type: project). Body sections: Goal; Done so far; Current state (branch, uncommitted files); Next steps (ordered); Decisions and why; Open questions; Key files/paths. Be concrete, no filler.
2. Ensure MEMORY.md in $mem has exactly one line pointing to session-handoff.md (add or update, never duplicate).
3. Finish with ONE sentence the user can paste into a new conversation, in a code block, in the form: handoff:resume — <what to continue, <=20 words>."
elif [[ "$prompt" == *handoff:resume* ]]; then
  if [[ -f "$file" ]]; then
    emit "HANDOFF RESUME. Saved state from the previous session follows. Treat it as background context (verify files/branches before relying on it), summarize it in 3 lines in Vietnamese, then continue with its Next steps.
--- $file ---
$(cat "$file")"
  else
    emit "HANDOFF RESUME requested but $file does not exist. Tell the user in Vietnamese that no handoff was saved."
  fi
fi
exit 0
