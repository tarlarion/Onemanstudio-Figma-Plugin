# OneManStudo Figma Plugin

OneManStudo is a Figma plugin with utility panels for independent designers:
style auditing, cleanup, frame renaming, detached component replacement,
comment review, and text extraction/regeneration.

## Run in Figma

1. Open **Plugins** -> **Development** -> **Import plugin from manifest...**
2. Select this folder, which contains `manifest.json`.
3. Run **OneManStudo - Swiss Army Knife for Independent Designers** from the
   development plugins menu.

The plugin UI opens at `760 x 640` and can be minimized or resized from the
plugin chrome.

## Files

- `manifest.json` - plugin name, entry points, permissions, and network allowlist.
- `code.js` - Figma main thread: document traversal, selection validation,
  canvas writes, exports, REST calls, and messages back to the UI.
- `ui.html` - plugin iframe: markup, styles, panel navigation, local storage,
  imports/exports, Make sync UI, and LLM provider requests.

There is no build step in this repository; Figma loads the files directly.

## Panel map

| Panel | Selection | Main workflow |
| --- | --- | --- |
| Styler | One frame or group | Scan text fills or non-text layer fills, then apply document paint/text styles or variables in bulk. |
| Cleaner | One frame | Find empty frame/group nodes, opacity-0 layers, and nodes with empty fill/stroke; hidden layers are detected internally but filtered from the shown cleanup list. |
| Frame Name | Selected frames | Rename frames with a prefix and sequence in layer-panel order. |
| Detach seek | One frame or section | Find detached local/library components, suggest matching library components, and replace selected matches. |
| Comments | Current page plus a Figma PAT | Fetch file comments from the Figma REST API and show comments attached to nodes on the current page. |
| Text | One frame | Extract descendant text layers, edit values, export/import CSV or JSON, sync to Make, and optionally use LLMs for semantic keys or copy regeneration. |

## Text panel workflow

1. Select exactly one `FRAME`.
2. Click **Extract text values**. The main thread walks all descendants and
   returns one row per `TEXT` node:
   - `id` - Figma node id used for safe updates.
   - `key` - generated placeholder in `{frameName}_key-{index}` format.
   - `value` - current text characters.
   - `layerName` - current text layer name, used as LLM context.
3. Edit values manually, import a CSV/JSON file, or switch to **LLM mode**.
4. Click **Apply changes** to write edited `value` fields back to Figma.

Only `value` is written back to text nodes. Keys are metadata for export,
localization, Make payloads, and LLM context; applying changes does not rename
Figma layers or persist keys into the document.

### CSV and JSON exchange

CSV export uses these columns:

```csv
id,key,value
12:34,home_hero_title,Start building today
```

CSV import requires a `value` column and at least one of `id` or `key`. Matching
by `id` is safest because placeholder keys can change when frame names or text
layer order change.

JSON export includes the extracted `frameId` and an `items` array with the row
fields above. Import accepts the same item shape.

## LLM mode

LLM mode is optional and runs from the plugin iframe. It sends the extracted
text rows plus a 1x PNG export of the selected frame to the selected provider.

Supported provider profiles:

| Provider | Endpoint used by UI | Default model | Model id format |
| --- | --- | --- | --- |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | `openai/gpt-4o-mini` | OpenRouter catalog slug, for example `openai/gpt-4o-mini`. |
| OpenAI | `https://api.openai.com/v1/chat/completions` | `gpt-4o-mini` | Native OpenAI model id. |
| DeepSeek | `https://api.deepseek.com/chat/completions` | `deepseek-chat` | Native DeepSeek model id. |
| Claude | `https://api.anthropic.com/v1/messages` | `claude-3-5-sonnet-20241022` | Native Anthropic model id. |

Provider settings are saved per provider in browser `localStorage` under
`openRouterProfilesByProviderV1`; the active provider is saved under
`openRouterProviderV1`. API keys are stored locally in the plugin iframe and are
sent directly to the selected third-party provider when an LLM action runs.

### Semantic keys

**Generate semantic keys** asks the provider for JSON mappings:

```json
{
  "mappings": [
    {
      "sourceId": "12:34",
      "suggestedKey": "hero_block_primary_cta",
      "reason": "Primary hero action"
    }
  ]
}
```

The UI sanitizes suggested keys to lower snake case and keeps them unique before
rendering the updated rows. Review the suggestions before exporting or using
them in downstream localization.

### Copy regeneration

**Regenerate all copy (LLM)** sends every extracted row. The per-row **LLM**
button sends only that row. The provider must return:

```json
{
  "rows": [
    {
      "sourceId": "12:34",
      "suggestedText": "Start building today",
      "reason": "Shorter CTA"
    }
  ]
}
```

Returned text replaces the row value in the UI only. Click **Apply changes** to
write regenerated copy to the Figma text nodes.

### LLM constraints and troubleshooting

- Extract text before running any LLM action; frame capture depends on the last
  extracted `frameId`.
- The frame must still exist and be a `FRAME`; otherwise capture returns
  "Frame not found (or selection changed). Extract again."
- OpenRouter/OpenAI/DeepSeek requests use JSON schema response formatting.
  Claude is prompted to return JSON and the UI parses the message text.
- The current manifest allowlist includes Figma REST, OpenRouter, and Make
  domains. Direct OpenAI, DeepSeek, and Claude calls use additional domains; add
  those domains to `manifest.json` before relying on direct-provider requests in
  Figma.

## Comments panel

The comments workflow calls `GET /v1/files/{fileKey}/comments` with a Figma
Personal Access Token. If the file key is not available from the plugin runtime,
paste a Figma file URL or raw file key. The UI filters returned comments to
nodes present on the current page.

Common failures:

- `403` - token is invalid, lacks access, or is missing `file_comments:read`.
- `404` - file key is wrong, the file is not saved, or the token cannot access
  the file.

## Make sync notes

The Text panel can sync the current extracted rows to a configured Make webhook
scenario stored in `localStorage`. The current UI hides the Make setup/status
entry points, so existing local scenarios can still enable **Sync current text
to Make**, but new scenario setup is not exposed in the panel.

## Permissions and network access

`manifest.json` currently declares:

- `documentAccess: "dynamic-page"` for document traversal on the active page.
- `permissions: ["teamlibrary"]` so the Styler and Detach workflows can inspect
  library styles, variables, and components.
- Network domains for Figma comments, OpenRouter, and Make webhooks.

Keep the network allowlist aligned with any provider endpoints used from
`ui.html`; Figma blocks requests to domains that are not listed.
