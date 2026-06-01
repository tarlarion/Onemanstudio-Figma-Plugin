# OneManStudio Figma Plugin

Swiss-army-knife Figma plugin for independent designers. It audits style usage, cleans empty layers, renames frames, replaces detached/local components, extracts editable text, and can send text rows to LLM or Make workflows.

## Repository shape

This is a direct-load Figma plugin. There is no build step, package manager, or test harness in this repository.

| File | Role |
| --- | --- |
| `manifest.json` | Plugin metadata, entry points, permissions, and network allowlist. |
| `code.js` | Main Figma plugin runtime. Reads/writes canvas nodes, loads styles and variables, exports frame screenshots, and handles messages from the UI. |
| `ui.html` | Complete plugin UI, styling, client-side state, CSV/JSON import/export, LLM calls, and Make webhook calls. |

## Run locally in Figma

1. Open Figma desktop or browser.
2. Go to **Plugins** -> **Development** -> **Import plugin from manifest...**.
3. Select this repository's `manifest.json`.
4. Run **OneManStudo - Swiss Army Knife for Independent Designers** from the development plugins list.

The plugin opens at `760x640`, supports manual resizing up to `1200x900`, and can be minimized to `200x48`.

## Main workflows

### Styler

Use Styler to find fills that are not connected to reusable design tokens.

- **Text tab**: Select exactly one frame or group, then scan text layers by fill. Results are grouped by local color, paint style, or color variable and include text style information when available.
- **Layers tab**: Select exactly one frame or group, then scan non-text layers with fills. Frames, groups, and shape-like nodes are grouped by fill style, variable, or local color.
- Group headers and row names can select matching layers on the canvas.
- Groups can be reassigned to an existing paint style, color variable, or text style. The plugin applies the selected token to all chosen node IDs and rescans after completion.

Constraints:

- Empty text layers are skipped by the style scan.
- Text fill changes are applied over the current character range; mixed or unsupported ranges may be skipped by Figma API safeguards.
- Library variables are imported by key when possible, so `manifest.json` includes the `teamlibrary` permission.

### Cleaner

Use Cleaner to remove visual noise from a selected frame.

1. Select exactly one frame.
2. Click **Find empty elements**.
3. Review empty frames/groups, hidden layers, zero-opacity layers, and layers with empty fill and stroke.
4. Delete selected results.

Hidden layers are detected during scanning but filtered out of the displayed delete list.

### Frame Name

Use Frame Name to rename selected frames consistently.

- Prefix must contain only letters and is stored in Figma `clientStorage`.
- Default order follows canvas position: top-to-bottom, then left-to-right.
- **Reverse layer panel order** follows the Layers panel bottom-to-top order instead.
- Output names use two-digit numbering, for example `Frame-01`, `Frame-02`.

### Detach seek

Use Detach seek to repair component drift.

- **Find detached** scans one selected frame or section for detached component-like nodes and suggests library components where possible.
- **Change detached** replaces selected detached entries with chosen library components.
- **Parse components** lists local and library component instances currently available in the document.
- **Replace with library** replaces selected local component instances with chosen library components.

Replacement preserves text content when possible by matching text layer names and loading fonts before assignment.

### Comments

The Comments panel fetches comments through the Figma REST API.

1. Enter a Figma Personal Access Token with `file_comments:read`.
2. Paste a file key from a `figma.com/file/...` or `figma.com/design/...` URL if Figma does not expose `figma.fileKey`.
3. Click **Grab comments** to list comments attached to nodes on the current page.

The token is stored in browser `localStorage` under `figma_plugin_token`.

### Text

The Text panel extracts all descendant `TEXT` layers from one selected frame and renders editable rows.

Core flow:

1. Select exactly one frame.
2. Click **Extract text values**.
3. Edit row values directly, export them, import translated/edited data, or use LLM helpers.
4. Click **Apply changes** to write values back to the original text node IDs.

Rows include:

- `id`: Figma node ID used for safe write-back.
- `key`: Initial placeholder key in the form `<frame_name>_key-<n>`, or a generated semantic key in LLM mode.
- `value`: Current or edited text.
- `layerName`: Included in JSON exports and Make payloads when available.

Import/export formats:

- CSV header: `id,key,value`
- JSON export shape:

```json
{
  "frameId": "12:34",
  "items": [
    {
      "id": "12:45",
      "key": "hero_block_title",
      "value": "Design faster",
      "layerName": "Headline"
    }
  ]
}
```

JSON imports can use either that export object or a bare items array. CSV imports must contain a `value` column and at least one of `id` or `key`. Import matches by `id` first, then by `key`.

## LLM text helpers

Switch Text to **LLM mode** to enable semantic key generation and copy regeneration. The UI exports a PNG screenshot of the selected frame from `code.js`, then sends the screenshot plus text rows from `ui.html` to the selected provider.

Supported provider profiles in the UI:

| Provider | Default model | Endpoint used by `ui.html` |
| --- | --- | --- |
| OpenRouter | `openai/gpt-4o-mini` | `https://openrouter.ai/api/v1/chat/completions` |
| OpenAI | `gpt-4o-mini` | `https://api.openai.com/v1/chat/completions` |
| DeepSeek | `deepseek-chat` | `https://api.deepseek.com/chat/completions` |
| Claude | `claude-3-5-sonnet-20241022` | `https://api.anthropic.com/v1/messages` |

LLM actions:

- **Generate semantic keys** asks the model to produce stable lower-snake-case resource keys based on screenshot context, frame name, layer names, and current copy.
- **Regenerate all copy (LLM)** asks the model to improve each extracted string while preserving intent and row boundaries.
- Per-row regenerate buttons request copy for one `sourceId`.

Output is staged in the Text panel only. Users must review the rows and click **Apply changes** before Figma text nodes are modified.

Operational constraints:

- API keys and provider profiles are stored in `localStorage`, not in Figma `clientStorage`.
- The current manifest allowlist includes OpenRouter, Figma REST, and Make domains. Direct OpenAI, DeepSeek, and Anthropic calls are present in `ui.html`; those provider modes need matching `networkAccess.allowedDomains` entries before they can work in environments that enforce the manifest allowlist.
- The model response must be JSON matching the schema requested by the UI. Markdown code fences are stripped, but malformed JSON fails the operation.
- Generated semantic keys are normalized to ASCII lower snake case and deduplicated with numeric suffixes.

## Make text sync

The Text panel contains Make scenario code for sending extracted text rows to an external Make webhook.

Scenario fields:

- Scenario name
- HTTPS Make webhook URL
- `scenario_key` for routing
- Target Google Sheet ID
- Optional target sheet tab
- Optional shared secret

Saved scenarios live in `localStorage` under `makeScenariosV1`; the active scenario ID is stored under `makeActiveScenarioIdV1`.

Current UI constraint: the setup view and handlers remain in `ui.html`, but the visible **Connect Make** entry point has been removed from the Text mode toolbar. **Sync current text to Make** only enables when an active scenario already exists in `localStorage`.

Webhook payload shape:

```json
{
  "event": "text_sync",
  "scenario_key": "marketing-copy",
  "target_sheet_id": "1AbCdEf...",
  "target_sheet_tab": "Sheet1",
  "plugin_user_id": "user-...",
  "frame_id": "12:34",
  "sent_at": "2026-06-01T16:00:00.000Z",
  "items": [
    {
      "id": "12:45",
      "key": "hero_block_title",
      "value": "Design faster",
      "layerName": "Headline"
    }
  ]
}
```

The setup form validates HTTPS URLs, `scenario_key`, and target sheet ID before saving or syncing.

## Storage and privacy notes

- Figma `clientStorage`: frame renamer prefix and layer-panel-order preference.
- Browser `localStorage`: UI theme, Figma comments token, Make scenarios, active Make scenario, LLM provider profiles, text mode, LLM panel expansion state, and generated plugin user ID.
- The plugin sends frame screenshots and text rows to the chosen LLM provider only when the user starts an LLM action.
- The plugin sends text rows to Make only when the user syncs an active scenario.

## Network and permissions

`manifest.json` currently declares:

- `networkAccess.allowedDomains`: `https://api.figma.com`, `https://openrouter.ai`, `https://hook.make.com`, `https://www.make.com`, `https://eu1.make.com`, and `https://us1.make.com`.
- `permissions`: `teamlibrary` for loading/importing available library components and variables.
- `documentAccess`: `dynamic-page`.

When adding a new external API, update `manifest.json` and document which UI action sends data to that domain.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Scan says "Select exactly one frame or group." | Styler scans require a single frame or group. Text extraction requires exactly one frame. |
| Text apply does not update some rows | Verify the frame was not deleted/reselected, the row still has a valid node `id`, and fonts are available for the target text node. |
| CSV import fails | Include `value` plus `id` or `key` headers. Keep commas/newlines quoted using standard CSV escaping. |
| LLM action says to save an API key | Choose a provider, enter its API key and model, then click **Save settings**. |
| Direct OpenAI/DeepSeek/Claude mode fails immediately | Add the provider domain to `manifest.json` `networkAccess.allowedDomains`; OpenRouter is already allowlisted. |
| Comments return 403 | Use a Figma token with `file_comments:read` and access to the file. |
| Comments return 404 | Paste the file key from the browser URL and confirm the file is saved and accessible. |
| Make sync fails | Confirm the webhook URL starts with `https://`, the scenario is active, and the Make scenario accepts JSON POST payloads. |

## Development notes

- `code.js` and `ui.html` communicate with `parent.postMessage` / `figma.ui.onmessage` message types. Keep new message names specific and document user-visible workflows here.
- Prefer updating existing panel sections rather than adding another top-level doc page while the repo remains this small.
- Keep plugin behavior verified against source before documenting it; this README should describe shipped UI and manifest constraints only.
