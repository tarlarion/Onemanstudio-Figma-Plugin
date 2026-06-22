# OneManStudio Figma Plugin

Swiss-army-knife Figma plugin for design maintenance workflows: style cleanup,
text extraction and rewriting, component replacement, frame renaming, and comment
review.

This repository is a direct-load Figma plugin. There is no package manager,
build step, or automated test harness in the repo.

## Run in Figma

1. Open Figma desktop or browser.
2. Go to **Plugins > Development > Import plugin from manifest...**.
3. Select this folder, or select `manifest.json` directly.
4. Run **OneManStudo - Swiss Army Knife for Independent Designers** from the
   development plugins list.

## Source layout

| File | Purpose |
| --- | --- |
| `manifest.json` | Plugin metadata, Figma entry points, `teamlibrary` permission, and network allowlist. |
| `code.js` | Figma sandbox code. Reads and mutates canvas nodes, imports library assets, exports frame images, calls the Figma REST comments API, and stores Figma client settings. |
| `ui.html` | Plugin UI, CSS, local browser storage, CSV/JSON import/export, Make webhook calls, and LLM API calls. |

The UI and sandbox communicate with `parent.postMessage({ pluginMessage })` from
`ui.html` and `figma.ui.onmessage` in `code.js`.

## Main workflows

### Styler

Use **Styler > Text** to scan one selected frame or group for descendant text
layers grouped by fill source:

- local solid color, including "No fill";
- local or library paint style;
- local or library color variable;
- text style summary for each color group when text style data is available.

Use **Styler > Layers** to scan non-text layers with fills. Both views can select
all rows in a group, select individual rows, and apply a paint style, color
variable, or text style back to the matched node IDs.

Constraints:

- The scan selection must be exactly one frame or group.
- Text layers with empty `characters` are skipped by the text color scan.
- Mixed fills and unsupported paint types are ignored where the Figma Plugin API
  cannot safely resolve them.

### Text extraction, import/export, and LLM mode

Use **Text** with exactly one selected frame. The plugin collects every
descendant `TEXT` node and renders editable rows:

```json
{
  "id": "12:34",
  "key": "Frame_key-1",
  "value": "Button label",
  "layerName": "Button/Text"
}
```

Manual mode supports:

- extracting text rows from a selected frame;
- editing values in the panel and applying them back to Figma;
- exporting CSV with `id,key,value` columns;
- exporting JSON as `{ "frameId": "...", "items": [...] }`;
- importing CSV or JSON, matched first by `id` and then by `key`.

LLM mode adds provider settings and two rewrite tools:

- **Generate semantic keys**: exports a PNG screenshot of the selected frame and
  asks the selected LLM for stable lower_snake_case resource keys.
- **Regenerate all copy (LLM)** and per-row **LLM** buttons: ask the selected
  LLM to rewrite all rows, or one row, using the screenshot and current row
  values as context.

Supported provider choices in the UI:

| Provider | Default model | Endpoint used by `ui.html` |
| --- | --- | --- |
| OpenRouter | `openai/gpt-4o-mini` | `https://openrouter.ai/api/v1/chat/completions` |
| OpenAI | `gpt-4o-mini` | `https://api.openai.com/v1/chat/completions` |
| DeepSeek | `deepseek-chat` | `https://api.deepseek.com/chat/completions` |
| Claude | `claude-3-5-sonnet-20241022` | `https://api.anthropic.com/v1/messages` |

LLM constraints:

- Settings are stored in the plugin UI `localStorage`, not in Figma
  `clientStorage`.
- Provider profiles are stored separately, but legacy OpenRouter/OpenAI storage
  keys are migrated when profiles are first created.
- The plugin expects strict JSON responses. It accepts plain JSON or a fenced
  JSON block, then sanitizes semantic keys to ASCII lower_snake_case and makes
  duplicates unique.
- LLM copy is staged in the panel only. Users must review and click **Apply
  changes** to write text back to Figma.

### Make text sync

The source includes a Make scenario setup view and sync logic for text rows.
Scenarios are stored in UI `localStorage` under `makeScenariosV1`, with an
active ID in `makeActiveScenarioIdV1`.

Scenario fields:

- scenario name;
- HTTPS Make webhook URL;
- `scenario_key`;
- target Google Sheet ID;
- optional target sheet tab;
- optional shared secret.

`connection_test` payload:

```json
{
  "event": "connection_test",
  "scenario_key": "marketing-copy",
  "target_sheet_id": "1AbCdEf...",
  "target_sheet_tab": "Sheet1",
  "plugin_user_id": "user-...",
  "sent_at": "2026-06-22T16:02:09.767Z",
  "items": []
}
```

`text_sync` payload adds the current frame ID and extracted text items:

```json
{
  "event": "text_sync",
  "scenario_key": "marketing-copy",
  "target_sheet_id": "1AbCdEf...",
  "target_sheet_tab": "Sheet1",
  "plugin_user_id": "user-...",
  "frame_id": "12:34",
  "sent_at": "2026-06-22T16:02:09.767Z",
  "items": [
    { "id": "12:35", "key": "hero_block_title", "value": "Welcome" }
  ]
}
```

Current constraints:

- The visible Text toolbar does not include the old Connect Make entry point.
  The setup view remains in `ui.html`, and sync works only when a scenario
  already exists in localStorage.
- The optional shared secret is saved with a scenario, but the current sender
  does not include it in the webhook payload or headers.
- Status rendering for Make setup/sync is suppressed in the current UI code.
- Webhooks must be HTTPS and must use a host allowed by `manifest.json`.

### Cleaner

Use **Cleaner** with exactly one selected frame. It scans descendants and reports
deletable empty elements:

- empty frame or group with no children, fills, or strokes;
- leaf node with opacity `0`;
- non-text leaf node with empty fill and stroke.

Hidden layers are detected internally but filtered out of the visible result
before rendering. Selected rows can be deleted from the document.

### Frame Name

Use **Frame Name** with one or more selected frames. The plugin renames
frames to `Prefix-01`, `Prefix-02`, and so on.

Constraints:

- Prefix accepts letters only and is stored in Figma `clientStorage` as
  `rewriterPrefix`.
- The reverse layer order toggle is stored as `rewriterLayerPanelOrder`.
- Default ordering follows canvas position: top to bottom, then left to right.
- Reverse layer order follows the Layers panel traversal from bottom to top.

### Detach seek and component replacement

Use **Detach seek** to find detached component instances in one selected frame or
section. The plugin suggests library components from existing library instances
in the document, preferring detached parent component keys when available and
falling back to name similarity.

Actions:

- **Find detached** lists detached items and suggested library replacements.
- **Change detached** replaces selected detached nodes with library instances,
  preserving position, rotation, approximate size, and text content by matching
  text layer names where possible.
- **Parse components** lists local components/component sets and library
  components discovered from instances.
- **Replace with library** replaces instances of selected local components with
  imported library components.

Constraints:

- Library suggestions come from library component instances already present in
  the file. The Plugin API does not expose an arbitrary library search here.
- Some replacement paths use `figma.importComponentByKeyAsync`; failures are
  reported in the plugin UI/debug status.

### Comments

Use **Comments** to fetch comments for the current page through the Figma REST
API.

Requirements:

- Enter a Figma Personal Access Token with `file_comments:read` scope.
- If `figma.fileKey` is unavailable, paste the file key or a full Figma
  `/file/` or `/design/` URL.

The plugin calls `GET https://api.figma.com/v1/files/{fileKey}/comments`, then
filters returned comments to node IDs present on the current page.

## Runtime interfaces

Common UI -> sandbox message types:

| Message | Source workflow | Sandbox behavior |
| --- | --- | --- |
| `scan` | Styler text | Scan one frame/group for text layers grouped by fill source. |
| `scanLayers` | Styler layers | Scan one frame/group for non-text fill groups. |
| `applyFillToGroup` | Styler | Apply paint style or color variable to node IDs. |
| `applyTextStyleToGroup` | Styler | Apply text style to text node IDs. |
| `extractTextKeyValues` | Text | Collect descendant text rows from one frame. |
| `captureFrameImageForLlm` | Text LLM | Export the extracted frame as a PNG data URL. |
| `updateTextKeyValues` | Text | Load fonts when possible and update text node characters. |
| `findEmptyElements` | Cleaner | Scan one frame for empty/deletable nodes. |
| `deleteNodes` | Cleaner | Remove selected node IDs. |
| `renameFrames` | Frame Name | Rename selected frames with prefix and ordering option. |
| `findDetached` | Detach seek | Find detached components in one frame/section. |
| `parseComponents` | Detach seek | Discover local components and library components from document instances. |
| `replaceDetached` | Detach seek | Replace selected detached nodes with library instances. |
| `replaceLocalWithLibrary` | Detach seek | Replace local component instances with library component instances. |
| `grabComments` | Comments | Fetch Figma REST comments and filter them to the current page. |
| `getStylesAndVariables` | Styler | Load local and available library paint styles, text styles, and color variables. |
| `resize` | Shell UI | Resize the plugin panel. |

## Storage and privacy

The plugin does not have a backend. Data stays in Figma, the plugin iframe, or
the external APIs the user explicitly calls.

UI `localStorage` keys:

- `pluginUiThemeV1`
- `figma_plugin_token`
- `figmaPluginUserIdV1`
- `makeScenariosV1`
- `makeActiveScenarioIdV1`
- `openRouterProviderV1`
- `openRouterProfilesByProviderV1`
- `openRouterApiKeyV1`
- `openRouterModelV1`
- legacy: `openAiApiKeyV1`, `openAiModelV1`
- `textModeV1`
- `textLlmSectionExpandedV1`

Figma `clientStorage` keys:

- `rewriterPrefix`
- `rewriterLayerPanelOrder`

Security notes:

- API keys and tokens are stored client-side in the plugin iframe localStorage.
- LLM requests include the selected frame screenshot and extracted text values.
- Make sync sends extracted text rows and routing metadata to the configured
  webhook URL.
- Comments fetching sends the Personal Access Token only to the Figma REST API.

## Network allowlist

`manifest.json` currently allows:

- `https://api.figma.com`
- `https://openrouter.ai`
- `https://hook.make.com`
- `https://www.make.com`
- `https://eu1.make.com`
- `https://us1.make.com`

The UI source also contains direct calls to:

- `https://api.openai.com`
- `https://api.deepseek.com`
- `https://api.anthropic.com`

If those direct providers are expected to work in Figma, add the provider domains
to `manifest.json` `networkAccess.allowedDomains` and reload the development
plugin. OpenRouter is already allowlisted.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| "Select exactly one frame or group." | Styler scans require one selected frame or group. |
| "Selected node must be a FRAME." | Text extraction and LLM tools require one selected frame, not a group. |
| LLM says to save an API key first | Save provider settings in LLM mode before generating keys or copy. |
| Direct OpenAI, DeepSeek, or Claude calls fail immediately | Confirm the provider domain is in `manifest.json` network access. |
| Make sync button stays disabled | Extract text rows first and ensure a Make scenario exists in `makeScenariosV1`. |
| Make webhook request fails | Use HTTPS and a host allowed by `manifest.json`; verify the Make scenario is active. |
| Comments return 403 | Use a Figma token with `file_comments:read` and access to the file. |
| Comments return 404 or missing file key | Paste the file key from a browser URL after `/file/` or `/design/`. |
| Text apply silently skips a row | The stored text node ID must still exist inside the extracted frame, and the font must be loadable. |

## Development notes

- Keep changes in plain `code.js`, `ui.html`, and `manifest.json` unless a build
  pipeline is intentionally introduced.
- Prefer documenting or extending the existing message contract instead of adding
  parallel UI-to-sandbox channels.
- When adding external APIs, update both the source code and
  `manifest.json.networkAccess.allowedDomains`.
- When adding persisted settings, document the storage key and whether it lives
  in UI `localStorage` or Figma `clientStorage`.
