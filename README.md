# OneManStudio Figma Plugin

A direct-load Figma plugin for independent designers. It scans selected
frames/groups for style issues, cleans empty layers, renames frames, repairs
detached components, and extracts text for manual, file-based, Make, or LLM
copy workflows.

There is no build step in this repository. Figma loads `manifest.json`,
`code.js`, and `ui.html` directly.

## Quick start

1. In Figma, open **Plugins > Development > Import plugin from manifest...**.
2. Select this repository's `manifest.json`.
3. Run **OneManStudo - Swiss Army Knife for Independent Designers** from the
   Development plugins menu.
4. Select the frame, group, or section required by the panel you are using.

## Repository layout

| File | Purpose |
| --- | --- |
| `manifest.json` | Plugin metadata, Figma API entry points, editor type, team library permission, and network allowlist. |
| `code.js` | Main-thread plugin code. Reads/writes Figma nodes, loads styles/variables, exports frame images, and handles messages from the UI. |
| `ui.html` | Plugin panel markup, styling, local UI state, API calls, import/export helpers, and message handlers. |

The message boundary is `parent.postMessage({ pluginMessage: ... })` from
`ui.html` to `figma.ui.onmessage` in `code.js`. Main-thread results are sent
back with `figma.ui.postMessage(...)` and handled by `window.addEventListener`
in the UI.

## Network and permissions

The manifest currently allows these external domains:

- `https://api.figma.com` for token validation and comment reads.
- `https://openrouter.ai` for OpenRouter chat completions.
- `https://hook.make.com`, `https://www.make.com`, `https://eu1.make.com`, and
  `https://us1.make.com` for Make workflows.

The UI also contains native-provider code paths for:

- OpenAI: `https://api.openai.com/v1/chat/completions`
- DeepSeek: `https://api.deepseek.com/chat/completions`
- Claude: `https://api.anthropic.com/v1/messages`

Those native domains are not in `manifest.json` today. Use OpenRouter as the
working default, or add the native provider domain to `networkAccess.allowedDomains`
before expecting direct OpenAI, DeepSeek, or Claude requests to work inside
Figma.

The plugin requests the `teamlibrary` permission so it can discover and import
library color variables for the Styler panel.

## Panels and workflows

### Styler

Use this panel with exactly one selected frame or group.

- **Text styles** scans text layers, groups them by fill source, and shows
  saved paint style, bound variable, direct color, or "No fill".
- It also summarizes text styling for each color group: saved text style,
  unsaved family/size/weight, mixed, or empty.
- **Layers** scans non-text fillable layers and groups them by fill source.
- Row checkboxes let you apply a selected paint style, variable, or text style
  to specific layers. Without selected rows, the dropdown applies to the row
  where it was opened.

Style data comes from local styles, styles already used in the document, and
available library variables. Library variables may be imported before binding
if Figma exposes `figma.variables.importVariableByKeyAsync`.

### Cleaner

Use this panel with exactly one selected frame.

- **Find empty elements** detects empty frames/groups, zero-opacity leaves, and
  fill/stroke-empty leaf nodes.
- Hidden nodes are detected in source but filtered out of the visible cleaner
  result.
- Select rows to delete them from the Figma file. Clicking a row selects the
  node on the canvas.

### Frame Name

Use this panel with one or more selected frames.

- Prefixes must contain letters only and are capped at 20 characters.
- Frames are renamed as `Prefix-01`, `Prefix-02`, etc.
- Default ordering is canvas position: top to bottom, then left to right.
- Enabling **Reverse layer panel order** uses layer tree traversal from bottom
  to top. The prefix and ordering preference are stored in `figma.clientStorage`.

### Detach seek

Use this panel with a selected frame or section when checking detached
components.

- **Find detached** lists nodes with `detachedInfo` and suggests library
  replacements from component metadata and name similarity.
- **Change detached** replaces selected detached nodes with imported or cloned
  library instances while preserving position, rotation, size when possible,
  and matching text contents by text layer name.
- **Parse components** lists local components/component sets and library
  components used by instances in the file.
- **Replace with library** replaces instances of selected local components with
  the chosen library component.

Library suggestions are based on components already discoverable in the
document. If a component cannot be imported by key, place an instance of that
library component in the file first.

### Text

Use this panel with exactly one selected frame.

1. Click **Extract text values**.
2. The plugin walks all text layers in the frame and creates editable rows:
   - `id`: Figma node id.
   - `key`: generated as `<frame-name>_key-<number>`.
   - `value`: current text contents.
   - `layerName`: original Figma text layer name, used as context.
3. Edit values manually, import a CSV/JSON file, sync to Make, or use LLM mode.
4. Click **Apply changes** to write updated values back to Figma.

Fonts are loaded before writing text where possible. Updates are constrained to
text node ids from the extracted frame, so imported rows cannot target arbitrary
nodes outside that frame.

#### CSV and JSON transfer formats

CSV export/import uses this header:

```csv
id,key,value
12:34,home_hero_title,Design faster
```

JSON export/import accepts either an array of rows or an object with `items`:

```json
{
  "frameId": "12:1",
  "items": [
    {
      "id": "12:34",
      "key": "home_hero_title",
      "value": "Design faster"
    }
  ]
}
```

Imports match rows by `id` first, then by `key`. Imported values update the
editable list only; click **Apply changes** to write them to Figma.

#### LLM mode

LLM mode is optional and keeps a review step between the model response and
Figma writes.

1. Switch to **LLM mode**.
2. Choose a provider:
   - OpenRouter default model: `openai/gpt-4o-mini`
   - OpenAI default model: `gpt-4o-mini`
   - DeepSeek default model: `deepseek-chat`
   - Claude default model: `claude-3-5-sonnet-20241022`
3. Enter an API key and model id, then click **Save settings**.
4. Extract text values from a frame.
5. Run one of:
   - **Generate semantic keys** to replace placeholder keys with stable
     lower-snake-case localization/resource keys.
   - **Regenerate all copy (LLM)** to rewrite every extracted text value.
   - Row-level **LLM** to rewrite one text value.
6. Review the list and click **Apply changes** when ready.

For LLM requests, `code.js` exports the selected frame as a PNG data URL and
the UI sends that image plus text rows to the selected provider. The expected
LLM responses are strict JSON:

- Semantic keys: `{ "mappings": [{ "sourceId", "suggestedKey", "reason" }] }`
- Copy regeneration: `{ "rows": [{ "sourceId", "suggestedText", "reason" }] }`

Semantic keys are sanitized to ASCII lower snake case and deduplicated with a
numeric suffix when needed.

### Make sync

The source still includes a Make setup view and payload sender, but the visible
"Connect Make" entry point is currently removed from the Text toolbar. In the
current UI, syncing requires a previously saved active scenario in
`localStorage`.

When an active scenario exists, **Sync current text to Make** sends:

```json
{
  "event": "text_sync",
  "scenario_key": "marketing-copy",
  "target_sheet_id": "1AbCdEf...",
  "target_sheet_tab": "Sheet1",
  "plugin_user_id": "user-...",
  "frame_id": "12:1",
  "sent_at": "2026-06-08T16:00:00.000Z",
  "items": [
    {
      "id": "12:34",
      "key": "home_hero_title",
      "value": "Design faster",
      "layerName": "Hero title"
    }
  ]
}
```

The setup form validates HTTPS webhook URLs, `scenario_key`, and target Google
Sheet id. It can also send a `connection_test` payload with an empty `items`
array.

### Comments

The Comments panel is present in source but hidden by CSS. If shown, it:

- Validates a Figma personal access token with `GET /v1/me`.
- Reads comments with `GET /v1/files/{fileKey}/comments`.
- Filters comments to nodes on the current page.

The token must include `file_comments:read` and access to the target file.

## Stored data

The plugin stores preferences in two places:

- `figma.clientStorage`: frame renamer prefix and layer-order preference.
- Browser `localStorage` in the plugin UI iframe:
  - UI theme and minimized/expanded preferences.
  - Text mode and LLM panel expansion.
  - LLM provider profiles, API keys, and model ids.
  - Make scenarios, webhook URLs, target sheet ids, and shared secrets.
  - Figma personal access token for the hidden Comments panel.
  - Generated plugin user id for Make payloads.

API keys, Make secrets, and Figma tokens are stored locally in the plugin UI
context. Do not commit or share browser storage exports containing these values.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| "Select exactly one frame or group." | Styler scans require one frame or group selection. Text extraction and Cleaner require one frame. Detach seek accepts one frame or section. |
| Direct OpenAI, DeepSeek, or Claude request fails immediately | Add the provider domain to `manifest.json` or use OpenRouter, which is already allowlisted. |
| LLM buttons are disabled | Extract text values first and save an API key/model for the selected provider. |
| LLM returns invalid payload | The UI expects strict JSON. Try a model with vision and JSON-schema support, or use OpenRouter with a compatible catalog model. |
| Text updates do not apply | Re-extract the frame if selection changed or nodes were deleted. The plugin only writes to text node ids from the extracted frame. |
| Library colors or variables do not appear | Confirm the file has library styles/variables available, the plugin was reloaded after manifest changes, and `teamlibrary` permission remains present. |
| Detached replacement cannot find a component | Place an instance of the target library component somewhere in the file, then rerun the scan. |
| Make sync stays disabled | The visible Make setup entry point is removed; an active scenario must already exist in `localStorage`. |

## Development notes

- Keep changes compatible with direct Figma loading; do not assume a bundler or
  package manager exists.
- Update `manifest.json` whenever new external domains are introduced.
- Prefer extending existing message types and UI helpers over adding parallel
  workflows.
- After editing `code.js`, reload the development plugin in Figma before
  testing because Figma caches plugin source between runs.
