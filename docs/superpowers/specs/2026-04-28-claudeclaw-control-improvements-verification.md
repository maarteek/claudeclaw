# Verification: ClaudeClaw control improvements

Date: 2026-04-28
Host: mak-node
Related design: `2026-04-28-claudeclaw-control-improvements-design.md` (to be written)
Related kickoff: `~/.claude/plans/claudeclaw-control-improvements-kickoff.md`

## Purpose

The proposed design captures `tool_use` and `tool_result` events from the Claude Agent SDK event stream so the recommendation-gate can answer: "before the assistant proposed a state change, did it actually call any tool that succeeded?"

The single new assumption is that the SDK exposes parseable `tool_use` and `tool_result` blocks with stable shape (tool name, id, error flag, content). The rest of the design rides on existing integrations already in daily use (Gemini API, SQLite memories table, Claude Code SDK init/result handling).

This verification proves that assumption against real production data: the anchor incident transcript itself.

Source data: `/home/marty/.claude/projects/-home-marty-claudeclaw/3e3184d9-cb5c-44b8-a798-9d8bd9682d45.jsonl` (623 KB, last modified 2026-04-28 00:39 — the search→add cycle from the anchor incident, per the kickoff).

SDK in use: `@anthropic-ai/claude-agent-sdk@^0.2.34` (from `~/claudeclaw/package.json`).

## Test 1: top-level event types

Confirms the SDK writes structured event records, not opaque blobs.

```
$ jq -r '.type // .message.type // "unknown"' /home/marty/.claude/projects/-home-marty-claudeclaw/3e3184d9-cb5c-44b8-a798-9d8bd9682d45.jsonl \
    | sort | uniq -c | sort -rn | head -20

    149 assistant
     91 user
     20 queue-operation
     10 progress
```

Assistant + user events are the two carriers of model/tool exchanges. 240 message events total in this transcript.

## Test 2: content block types within messages

Confirms the SDK structures tool calls and results as discrete blocks, matching the public Anthropic message-content API.

```
$ jq -r '.message.content[]? | .type' /home/marty/.claude/projects/-home-marty-claudeclaw/3e3184d9-cb5c-44b8-a798-9d8bd9682d45.jsonl \
    | sort | uniq -c | sort -rn

     81 tool_use
     81 tool_result
     58 text
     10 thinking
```

81 tool_use blocks paired 1:1 with 81 tool_result blocks. Symmetric — every tool call has its result on disk.

## Test 3: tool_use exposes name and id

Confirms the recommendation-gate and circuit-breaker design can identify *which* tool was called, including the MCP server prefix.

```
$ jq -c '.message.content[]? | select(.type == "tool_use") | {id, name, input_keys: (.input | keys)}' \
    /home/marty/.claude/projects/-home-marty-claudeclaw/3e3184d9-cb5c-44b8-a798-9d8bd9682d45.jsonl | head -2

{"id":"toolu_011BYR3rkjKoZHrjfK29nv9M","name":"ToolSearch","input_keys":["max_results","query"]}
{"id":"toolu_0178VfviCRS6qCsofeG1jNXV","name":"mcp__mcp-torrent-search__get_download_status","input_keys":[]}
```

The `name` field carries the canonical `mcp__<server>__<tool>` form, which lets the circuit-breaker design key its streak counter on MCP server name (split on `__`).

## Test 4: tool_result exposes tool_use_id and is_error

Confirms results are matchable back to their tool_use, and success/error is a discrete field.

```
$ jq -c '.message.content[]? | select(.type == "tool_result") | {tool_use_id, is_error, content_preview: (if .content | type == "string" then .content[0:120] else (.content[0]? | .text[0:120]) end)}' \
    /home/marty/.claude/projects/-home-marty-claudeclaw/3e3184d9-cb5c-44b8-a798-9d8bd9682d45.jsonl | head -4

{"tool_use_id":"toolu_011BYR3rkjKoZHrjfK29nv9M","is_error":null,"content_preview":null}
{"tool_use_id":"toolu_0178VfviCRS6qCsofeG1jNXV","is_error":null,"content_preview":"{\"result\":[{\"info_hash\":\"c0c0b9b59e4edb65cfa16537cfbefbf10c02415a\",\"name\":\"Avatar 2009 UHD 4K BluRay 2160p ReMux HEVC HD"}
{"tool_use_id":"toolu_01Cx9UNECtFCBobnAu4VTkEd","is_error":false,"content_preview":"172.67.154.19\n104.21.13.5"}
{"tool_use_id":"toolu_01DoHLyjyVsNFwugqDApSq1W","is_error":false,"content_preview":"HTTP 200 | IP 2606:4700:3032::6815:d05 | Time 1.532340s | Redirect"}
```

`tool_use_id` matches the `id` from tool_use (test 3). `is_error` is a tri-valued field: `null` | `false` | `true`. Content carries the raw output.

## Test 5: is_error value distribution

Confirms the field actually takes the `true` value — not just nominal type but real semantics.

```
$ jq -c '.message.content[]? | select(.type == "tool_result") | .is_error' \
    /home/marty/.claude/projects/-home-marty-claudeclaw/3e3184d9-cb5c-44b8-a798-9d8bd9682d45.jsonl \
    | sort | uniq -c

     41 false
     38 null
      2 true
```

Across 81 tool calls in this transcript, 79 returned without error and 2 returned with `is_error: true`. The error path is exercised in this transcript. Treating `is_error === true` as "error" and anything else as "non-error" is the correct test.

## Test 6: real error tool_result content

Confirms the actual error payload is intact and parseable — important because the circuit-breaker design wants to dump raw errors verbatim to the user when the streak threshold trips.

```
$ jq -c '.message.content[]? | select(.type == "tool_result" and .is_error == true) | {tool_use_id, is_error, content_preview: (if .content | type == "string" then .content[0:200] else (.content[0]? | .text[0:200]) end)}' \
    /home/marty/.claude/projects/-home-marty-claudeclaw/3e3184d9-cb5c-44b8-a798-9d8bd9682d45.jsonl | head -3

{"tool_use_id":"toolu_01LakPr1pTNdamhsrCdKUWbP","is_error":true,"content_preview":"Exit code 1\nSID: ...\nForbidden\nTraceback (most recent call last):\n  File \"<string>\", line 1, in <module>\n  File \"/usr/lib/python3.12/json/__init__.py\", line 293, in load\n    return loads(fp.read(),\n  "}
{"tool_use_id":"toolu_01Vi4sCxw5Hmu8onTt9CYGeA","is_error":true,"content_preview":"Exit code 1\nTraceback (most recent call last):\n  File \"<string>\", line 5, in <module>\nAttributeError: 'str' object has no attribute 'get'\n\nTraceback (most recent call last):\n  File \"<string>\", line 5,"}
```

Full traceback survives. Suitable for verbatim user-facing display when the circuit-breaker fires.

## Test 7: tool_use and tool_result roles

Confirms the role partition: assistant-role messages carry tool_use blocks, user-role messages carry tool_result blocks. This is what tells `agent.ts` where to look in its existing event loop.

```
$ jq -r '. | select(.message.content) | (.message.role + " " + (.message.content[0].type // "empty"))' \
    /home/marty/.claude/projects/-home-marty-claudeclaw/3e3184d9-cb5c-44b8-a798-9d8bd9682d45.jsonl \
    | sort | uniq -c

     58 assistant text
     10 assistant thinking
     81 assistant tool_use
     81 user tool_result
```

(Eleven `Cannot index string with number` errors omitted — those are events whose `.content` is a plain string, which is the user's pre-tool-loop input, irrelevant to this verification.)

Clean partition. The recommendation-gate design's "iterate `ev.message.content` blocks for `tool_use_id`/`is_error`/`name`" is grounded in real shape.

## Test 8: agent.ts already iterates this exact shape

Confirms the proposed change ("capture tool_use_result events into result.toolEvents[]") is an extension of code that already runs in production, not a new SDK integration.

```
$ grep -n -E "ev\['type'\]|ev\.type|content\[" src/agent.ts | head -10

249:      if (ev['type'] === 'system' && ev['subtype'] === 'init') {
255:      if (ev['type'] === 'system' && ev['subtype'] === 'compact_boundary') {
268:      if (ev['type'] === 'assistant') {
294:      if (ev['type'] === 'system' && ev['subtype'] === 'task_started' && onProgress) {
298:      if (ev['type'] === 'system' && ev['subtype'] === 'task_notification' && onProgress) {
310:      if (ev['type'] === 'stream_event' && onStreamText && ev['parent_tool_use_id'] === null) {
324:      if (ev['type'] === 'result') {
```

`agent.ts:268-291` already handles `ev.type === 'assistant'` and walks `msg.content` looking for `block.type === 'tool_use'` and pulling `block.name` for progress reporting. The proposed change adds a sibling branch for `ev.type === 'user'` walking `msg.content` for `block.type === 'tool_result'`. Same iteration pattern, same field names, no new SDK affordance.

## Outcome: GO

Every assumption the design relies on is observable in real production data and accessible via code already running in `agent.ts`.

| Assumption | Evidence | Status |
|---|---|---|
| SDK exposes structured events | Test 1 — 4 distinct event types | proven |
| tool_use and tool_result are first-class blocks | Test 2 — 81 + 81 paired blocks | proven |
| Tool name (incl. MCP prefix) is in tool_use | Test 3 — `name: "mcp__mcp-torrent-search__..."` | proven |
| Results match back to calls | Test 4 — `tool_use_id` field | proven |
| Error/success is a discrete field | Test 5 — 41 false, 38 null, 2 true | proven |
| Error content is preserved | Test 6 — full traceback intact | proven |
| Role partition is clean | Test 7 — assistant→tool_use, user→tool_result | proven |
| agent.ts can extend its existing iteration | Test 8 — same pattern at line 268 | proven |

No tests required user action. No tests failed. Design may proceed.

## Tests awaiting user action

None.
