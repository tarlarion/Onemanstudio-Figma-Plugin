# OneManStudio Figma Plugin

A direct-load Figma plugin for independent designers. It audits styles, edits text
content, helps generate text keys/copy with an LLM, renames frames, removes empty
layers, and replaces detached components.

The plugin has no build step: Figma loads `code.js` as the plugin controller and
`ui.html` as the panel.

## Quick start

1. In Figma, open **Plugins** -> **Development** -> **Import plugin from manifest...**.
2. Select this repository folder, the one that contains `manifest.json`.
3. Run **OneManStudo — Swiss Army Knife for Independent Designers** from the
   development plugins menu.

## Repository layout

| File | Purpose |
| --- | --- |
| `manifest.json` | Plugin metadata, Figma permissions, network allowlist, and entry points. |
| `code.js` | Figma-side controller. Reads/writes canvas nodes, loads styles, exports frames, and handles messages from the UI. |
| `ui.html` | Complete panel UI, styling, local state, imports/exports, Make webhooks, and LLM API calls. |

There is currently no package manager, bundler, lint task, or automated test
harness in the repository.

## Architecture

The implementation is split across the Figma sandbox and the UI iframe:

```text
ui.html
  - renders the panel
  - stores user settings in localStorage
  - calls external HTTP APIs with fetch()
  - sends pluginMessage events to code.js

code.js
  - receives figma.ui.onmessage events
  - validates the current selection
  - traverses Figma nodes/styles/variables
  - writes canvas changes
  - posts result messages back to ui.html
```

Most workflows require a single selected `FRAME` or `GROUP`. Text-editing and LLM
workflows require exactly one `FRAME`; detached-component scanning accepts a
`FRAME` or `SECTION`.

## Panels and workflows

### Styler

Use **Styler** to scan selected frames or groups for fill usage.

- **Text** tab: finds descendant `TEXT` layers and groups them by direct color,
  paint style, or color variable. Each row also includes text style metadata when
  available.
- **Layers** tab: scans non-text layers with fills and groups them by direct
  color, paint style, or color variable.
- Dropdowns can apply a paint style or color variable to a group of layers.
- Text rows can also receive a selected text style.

Relevant codepaths:

- UI events: `scan`, `scanLayers`, `applyFillToGroup`, `applyTextStyleToGroup`
- Controller functions: `scanTextLayersByFill`, `scanShapeLayersByFill`,
  `loadDocumentStyles`, `getStylesAndVariables`

### Text

Use **Text** to extract, edit, import, export, and apply copy for one selected
frame.

1. Select exactly one frame.
2. Click **Extract text values**.
3. Edit values in the list, import rows, export rows, or use LLM actions.
4. Click **Apply changes** to write values back to Figma text nodes.

Extracted rows use this shape:

```json
{
  "id": "12:34",
  "key": "Frame_key-1",
  "value": "Button label",
  "layerName": "CTA"
}
```

The generated default key is `<frame name>_key-<index>`. The plugin writes text
back by node `id`, after verifying the node still belongs to the extracted frame.
It loads the current font for each text node before assigning `characters`.

#### Import/export formats

CSV exports use a header:

```csv
id,key,value
12:34,hero_block_title,Start designing faster
```

CSV imports must contain a `value` column and at least one of `id` or `key`.
JSON imports may be either an array of rows or an object with an `items` array:

```json
{
  "items": [
    { "id": "12:34", "key": "hero_block_title", "value": "Start faster" }
  ]
}
```

Imported rows update the panel list only. Click **Apply changes** to update Figma.

Relevant codepaths:

- UI events: `extractTextKeyValues`, `updateTextKeyValues`,
  `captureFrameImageForLlm`
- Controller functions: `collectTextKeyValuesFromFrame`,
  `collectTextNodeIdsFromFrame`, `loadFontForTextNodeIfPossible`

### LLM mode in Text

LLM mode adds semantic-key generation and copy regeneration on top of the
extracted text list.

Supported provider options in the UI:

| Provider | Endpoint used by `ui.html` | Default model |
| --- | --- | --- |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | `openai/gpt-4o-mini` |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` |
| DeepSeek | `https://api.deepseek.com/chat/completions` | `deepseek-chat` |
| Claude | `https://api.anthropic.com/v1/messages` | `claude-3-5-sonnet-20241022` |

LLM actions work as follows:

1. The UI validates that text rows, model, and API key are present.
2. `code.js` exports the selected frame as a PNG data URL.
3. `ui.html` sends the screenshot plus text-row JSON to the selected provider.
4. The provider must return JSON matching the expected schema.
5. The UI updates the extracted list. The canvas is unchanged until
   **Apply changes** is clicked.

Semantic-key generation asks for stable lower-snake-case keys that describe UI
structure rather than visible copy. Returned keys are sanitized to ASCII
`[a-z0-9_]`, cannot start with a digit, and are de-duplicated with numeric
suffixes.

Copy regeneration can run for all rows or one row. It asks for a replacement
`suggestedText` for each input `sourceId` and merges responses back into the
panel list by `sourceId`.

#### Network allowlist constraint

`manifest.json` currently allowlists:

- `https://api.figma.com`
- `https://openrouter.ai`
- `https://hook.make.com`
- `https://www.make.com`
- `https://eu1.make.com`
- `https://us1.make.com`

OpenAI, DeepSeek, and Anthropic endpoints are implemented in `ui.html`, but their
domains are not in the manifest allowlist. In Figma, direct provider modes may be
blocked until the manifest allowlist is updated. OpenRouter is the configured
provider path that matches the current manifest.

#### Saved LLM settings

LLM settings are stored in browser `localStorage` inside the plugin UI:

- `openRouterProfilesByProviderV1`: provider-specific API keys and models
- `openRouterProviderV1`: active provider
- `openRouterApiKeyV1` / `openRouterModelV1`: legacy active fields
- `openAiApiKeyV1` / `openAiModelV1`: legacy migration fallback
- `textModeV1`: `manual` or `llm`
- `textLlmSectionExpandedV1`: collapsed/expanded state

Treat these values as local developer/user state. Do not commit API keys.

### Make sync

The Text panel includes Make scenario storage and webhook sync logic. The visible
Connect Make entry point is not rendered in the current toolbar, but saved
scenarios are still loaded from `localStorage` and can enable **Sync current text
to Make**.

Saved scenario fields:

- scenario name
- Make webhook URL
- scenario key
- target Google Sheet ID
- optional target sheet tab
- optional shared secret field

Webhook payloads use this shape:

```json
{
  "event": "text_sync",
  "scenario_key": "marketing-copy",
  "target_sheet_id": "1AbCdEf...",
  "target_sheet_tab": "Sheet1",
  "plugin_user_id": "user-...",
  "frame_id": "12:34",
  "sent_at": "2026-06-15T16:00:00.000Z",
  "items": [
    { "id": "12:34", "key": "hero_block_title", "value": "Start faster" }
  ]
}
```

The test connection sends the same routing fields with
`event: "connection_test"` and an empty `items` array.

### Cleaner

Use **Cleaner** to scan one selected frame for removable elements. The scanner
finds empty frames/groups, layers with opacity `0`, hidden layers, and leaf nodes
with empty fill/stroke. Hidden layers are filtered out before rendering deletion
candidates. Selected rows can be deleted from the canvas.

Relevant codepaths:

- UI events: `findEmptyElements`, `deleteNodes`, `selectNode`
- Controller functions: `findEmptyElements`, `runFindEmptyElements`

### Frame Name

Use **Frame Name** to rename selected frames with a letters-only prefix and a
two-digit counter, for example `Frame-01`.

Ordering modes:

- Default: canvas position, top-to-bottom then left-to-right.
- Reverse layer panel order: walks the page by layer tree order and numbers
  bottom-to-top relative to the Layers panel copy.

The prefix is saved in Figma `clientStorage` as `rewriterPrefix`; the ordering
preference is saved as `rewriterLayerPanelOrder`.

### Detach seek

Use **Detach seek** to find detached components in a selected frame or section.
The plugin suggests library replacements from component metadata first, then by
name similarity against library components already found in the document.

Replacement behavior:

- Preserves approximate position, size, rotation, and parent index.
- Copies matching text-layer content by layer name into the new instance when
  possible.
- Uses an existing instance/component in the document when available, otherwise
  attempts `figma.importComponentByKeyAsync`.

Library component discovery is based on instances already present in the file.
If a library component is not suggested, place an instance of that component in
the document and scan again.

### Comments

The Comments panel exists in the code but its navigation item is hidden by CSS.
When exposed, it reads comments through the Figma REST API with a personal access
token and optional file key. The token is stored in `localStorage` as
`figma_plugin_token`.

The REST call requires a token with `file_comments:read` access and uses:

```text
GET https://api.figma.com/v1/files/<fileKey>/comments
```

Only comments whose `client_meta.node_id` belongs to the current page are shown.

## Permissions and external access

The plugin uses:

- `documentAccess: "dynamic-page"`
- `permissions: ["teamlibrary"]`
- network access for Figma REST, OpenRouter, and Make domains listed in
  `manifest.json`

The `teamlibrary` permission is used for loading available library variable
collections and importing color variables by key.

## Troubleshooting

### "Select exactly one frame or group"

Styler scans require one `FRAME` or `GROUP`. Text extraction requires one
`FRAME`. Detach seek requires one `FRAME` or `SECTION`.

### LLM provider request fails immediately

Check the manifest allowlist. The current manifest allows OpenRouter but does not
allow direct OpenAI, DeepSeek, or Anthropic domains.

### "Save your API key first"

Open LLM mode, select the provider, enter the API key and model, then click
**Save settings**. Settings are local to the plugin UI browser context.

### Imported text did not update the canvas

Import only updates the editable list. Click **Apply changes** after reviewing
the imported values.

### Make sync button is disabled

The button requires extracted text rows and an active saved Make scenario in
`localStorage`. The current UI does not show the Connect Make entry point.

### Detached replacement cannot find a component

Place an instance of the desired library component somewhere in the Figma file,
then run **Find detached** again. This lets the plugin discover the library
component key from the document.
