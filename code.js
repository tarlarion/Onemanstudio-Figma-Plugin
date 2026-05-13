/**
 * Text Styles – list text layers by fill: direct hex, empty fill, or saved fill style (with style name).
 */

function paintToHex(paint) {
  if (!paint || paint.type !== "SOLID" || !paint.color) return null;
  var r = Math.round((paint.color.r || 0) * 255);
  var g = Math.round((paint.color.g || 0) * 255);
  var b = Math.round((paint.color.b || 0) * 255);
  var a = paint.opacity != null ? paint.opacity : 1;
  if (a < 1) return "rgba(" + r + "," + g + "," + b + "," + Math.round(a * 100) / 100 + ")";
  return "#" + [r, g, b].map(function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
}

function getFirstSolidPaint(paints) {
  if (!paints || !Array.isArray(paints)) return null;
  for (var i = 0; i < paints.length; i++) {
    if (paints[i] && paints[i].type === "SOLID") return paints[i];
  }
  return null;
}

function collectNodes(node, list) {
  if (!node) return;
  list.push(node);
  try {
    var kids = node.children;
    if (kids && kids.length > 0) {
      for (var i = 0; i < kids.length; i++) {
        collectNodes(kids[i], list);
      }
    }
  } catch (_) {}
}

function collectTextContentsFromNode(node) {
  var out = [];
  try {
    var list = [];
    collectNodes(node, list);
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n.type !== "TEXT") continue;
      var chars = n.characters != null ? n.characters : "";
      var fontName = null;
      if (chars.length > 0 && n.getRangeFontName) {
        try {
          fontName = n.getRangeFontName(0, 1);
          if (fontName === figma.mixed && chars.length > 0) fontName = n.getRangeFontName(0, Math.min(1, chars.length));
        } catch (_) {}
      }
      out.push({ name: n.name || "", characters: chars, fontName: fontName });
    }
  } catch (_) {}
  return out;
}

function applyTextContentsToInstance(instance, textContents) {
  if (!textContents || textContents.length === 0) return Promise.resolve();
  var idx = 0;
  function next() {
    if (idx >= textContents.length) return Promise.resolve();
    var item = textContents[idx];
    idx++;
    var target = null;
    try {
      if (instance.findOne) {
        target = instance.findOne(function (n) { return n.type === "TEXT" && (n.name || "") === (item.name || ""); });
      }
      if (!target && instance.findAll) {
        var all = instance.findAll(function (n) { return n.type === "TEXT"; });
        for (var i = 0; i < all.length; i++) {
          if ((all[i].name || "") === (item.name || "")) { target = all[i]; break; }
        }
      }
    } catch (_) {}
    if (!target || target.removed) return next();
    var fontToLoad = item.fontName && typeof item.fontName === "object" && item.fontName !== figma.mixed ? item.fontName : null;
    if (!fontToLoad && target.characters && target.characters.length > 0 && target.getRangeFontName) {
      try {
        fontToLoad = target.getRangeFontName(0, 1);
        if (fontToLoad === figma.mixed) fontToLoad = null;
      } catch (_) {}
    }
    if (fontToLoad === figma.mixed) fontToLoad = null;
    var loadPromise = fontToLoad && figma.loadFontAsync ? figma.loadFontAsync(fontToLoad) : Promise.resolve();
    return loadPromise.then(function () {
      try {
        if (!target.removed) target.characters = item.characters || "";
      } catch (_) {}
      return next();
    }).catch(function () { return next(); });
  }
  return next();
}

function collectTextKeyValuesFromFrame(frameNode) {
  var all = [];
  collectNodes(frameNode, all);
  var items = [];
  var frameName = (frameNode && typeof frameNode.name === "string" && frameNode.name.trim())
    ? frameNode.name.trim()
    : "frame";
  var keyIndex = 0;

  for (var i = 0; i < all.length; i++) {
    var n = all[i];
    if (!n || n.type !== "TEXT") continue;
    keyIndex++;
    var displayKey = frameName + "_key-" + keyIndex;

    var value = n.characters != null ? String(n.characters) : "";
    items.push({ id: n.id, key: displayKey, value: value });
  }
  return items;
}

function collectTextNodeIdsFromFrame(frameNode) {
  var all = [];
  collectNodes(frameNode, all);
  var set = {};
  for (var i = 0; i < all.length; i++) {
    var n = all[i];
    if (n && n.type === "TEXT") set[n.id] = true;
  }
  return set;
}

function uint8ArrayToBase64(bytes) {
  if (!bytes) return "";
  try {
    if (typeof figma.base64Encode === "function") return figma.base64Encode(bytes);
  } catch (_) {}
  var bin = "";
  var chunkSize = 8192;
  for (var i = 0; i < bytes.length; i += chunkSize) {
    var chunk = bytes.slice(i, i + chunkSize);
    bin += String.fromCharCode.apply(null, chunk);
  }
  try {
    return btoa(bin);
  } catch (_) {
    return "";
  }
}

function loadFontForTextNodeIfPossible(node) {
  if (!node || node.type !== "TEXT") return Promise.resolve();
  if (!figma.loadFontAsync || typeof node.getRangeFontName !== "function") return Promise.resolve();

  var len = node.characters ? node.characters.length : 0;
  var fontName = null;
  try {
    // When text is empty, getRangeFontName can still throw; we ignore failures.
    if (len > 0) fontName = node.getRangeFontName(0, 1);
    else {
      try { fontName = node.getRangeFontName(0, 1); } catch (_) {}
    }
  } catch (_) {}

  if (!fontName || fontName === figma.mixed) return Promise.resolve();
  return figma.loadFontAsync(fontName).catch(function () {});
}

function fontStyleToWeight(style) {
  if (!style || typeof style !== "string") return null;
  var s = style.toLowerCase();
  if (s.indexOf("thin") >= 0) return 100;
  if (s.indexOf("extralight") >= 0 || s.indexOf("extra light") >= 0) return 200;
  if (s.indexOf("light") >= 0) return 300;
  if (s.indexOf("regular") >= 0 || s.indexOf("normal") >= 0) return 400;
  if (s.indexOf("medium") >= 0) return 500;
  if (s.indexOf("semibold") >= 0 || s.indexOf("semi bold") >= 0 || s.indexOf("demi") >= 0) return 600;
  if (s.indexOf("bold") >= 0) return 700;
  if (s.indexOf("extrabold") >= 0 || s.indexOf("extra bold") >= 0) return 800;
  if (s.indexOf("black") >= 0) return 900;
  return null;
}

function getTextStyleInfoForNode(n, len) {
  var out = { textStyleId: null, fontFamily: null, fontStyle: null, fontSize: null, fontWeight: null };
  try {
    var tsId = len > 0 ? n.getRangeTextStyleId(0, len) : null;
    if (typeof tsId === "string" && tsId && tsId !== "") {
      out.textStyleId = tsId;
      return out;
    }
    if (tsId === figma.mixed && len > 0) {
      tsId = n.getRangeTextStyleId(0, 1);
      if (typeof tsId === "string" && tsId && tsId !== "") {
        out.textStyleId = tsId;
        return out;
      }
    }
  } catch (_) {}
  try {
    var fontName = len > 0 ? n.getRangeFontName(0, len) : null;
    if (fontName === figma.mixed && len > 0) fontName = n.getRangeFontName(0, 1);
    if (fontName && typeof fontName === "object" && fontName.family) {
      out.fontFamily = fontName.family;
      out.fontStyle = fontName.style || null;
      out.fontWeight = fontStyleToWeight(fontName.style);
    }
  } catch (_) {}
  try {
    var sz = len > 0 ? n.getRangeFontSize(0, len) : null;
    if (sz === figma.mixed && len > 0) sz = n.getRangeFontSize(0, 1);
    if (typeof sz === "number") out.fontSize = sz;
  } catch (_) {}
  return out;
}

// Returns raw list: either { type:'color', colorKey, colorHex, color, id, name } or { type:'style', styleId, id, name }.
// Each item also has textStyleId?, fontFamily?, fontStyle?, fontSize?, fontWeight? for text style display.
function collectTextLayersByFill(node) {
  var all = [];
  collectNodes(node, all);
  var list = [];
  for (var i = 0; i < all.length; i++) {
    var n = all[i];
    if (n.type !== "TEXT") continue;
    var name = n.name || "Unnamed";
    try {
      var len = n.characters ? n.characters.length : 0;
      if (len === 0) continue;
      var textStyleInfo = getTextStyleInfoForNode(n, len);
      var fillStyleId = n.getRangeFillStyleId(0, len);
      if (typeof fillStyleId === "string" && fillStyleId !== "") {
        list.push({ type: "style", styleId: fillStyleId, id: n.id, name: name, textStyleId: textStyleInfo.textStyleId, fontFamily: textStyleInfo.fontFamily, fontStyle: textStyleInfo.fontStyle, fontSize: textStyleInfo.fontSize, fontWeight: textStyleInfo.fontWeight });
        continue;
      }
      try {
        var boundVar = n.getRangeBoundVariable && n.getRangeBoundVariable(0, len, "fills");
        if (boundVar && typeof boundVar === "object" && boundVar.id) {
          list.push({ type: "variable", variableId: boundVar.id, id: n.id, name: name, textStyleId: textStyleInfo.textStyleId, fontFamily: textStyleInfo.fontFamily, fontStyle: textStyleInfo.fontStyle, fontSize: textStyleInfo.fontSize, fontWeight: textStyleInfo.fontWeight });
          continue;
        }
      } catch (_) {}
      try {
        var segments = n.getStyledTextSegments && n.getStyledTextSegments(["fills"], 0, len);
        if (segments && segments.length > 0) {
          var firstFillsArr = segments[0].fills;
          if (Array.isArray(firstFillsArr) && firstFillsArr.length > 0) {
            var p0 = firstFillsArr[0];
            if (p0 && p0.boundVariables && p0.boundVariables.color && p0.boundVariables.color.id) {
              list.push({ type: "variable", variableId: p0.boundVariables.color.id, id: n.id, name: name, textStyleId: textStyleInfo.textStyleId, fontFamily: textStyleInfo.fontFamily, fontStyle: textStyleInfo.fontStyle, fontSize: textStyleInfo.fontSize, fontWeight: textStyleInfo.fontWeight });
              continue;
            }
          }
        }
      } catch (_) {}
      var fills = n.getRangeFills(0, len);
      var paint = null;
      var colorKey = "__none";
      var colorHex = "No fill";
      var color = null;
      if (Array.isArray(fills)) {
        paint = getFirstSolidPaint(fills);
        if (paint) {
          colorHex = paintToHex(paint);
          if (colorHex) {
            colorKey = colorHex;
            color = paint.color;
          }
        }
      } else if (fills === figma.mixed && len > 0) {
        var firstFills = n.getRangeFills(0, 1);
        if (Array.isArray(firstFills)) {
          paint = getFirstSolidPaint(firstFills);
          if (paint) {
            colorHex = paintToHex(paint);
            if (colorHex) {
              colorKey = colorHex;
              color = paint.color;
            }
          }
        }
      }
      list.push({ type: "color", colorKey: colorKey, colorHex: colorHex, color: color, id: n.id, name: name, textStyleId: textStyleInfo.textStyleId, fontFamily: textStyleInfo.fontFamily, fontStyle: textStyleInfo.fontStyle, fontSize: textStyleInfo.fontSize, fontWeight: textStyleInfo.fontWeight });
    } catch (_) {}
  }
  return list;
}

async function scanTextLayersByFill(node) {
  var list = collectTextLayersByFill(node);

  var styleIds = [];
  var variableIds = [];
  var textStyleIds = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].type === "style" && list[i].styleId && styleIds.indexOf(list[i].styleId) === -1) {
      styleIds.push(list[i].styleId);
    }
    if (list[i].type === "variable" && list[i].variableId && variableIds.indexOf(list[i].variableId) === -1) {
      variableIds.push(list[i].variableId);
    }
    if (list[i].textStyleId && textStyleIds.indexOf(list[i].textStyleId) === -1) {
      textStyleIds.push(list[i].textStyleId);
    }
  }

  var textStyleNames = {};
  for (var t = 0; t < textStyleIds.length; t++) {
    try {
      var ts = await figma.getStyleByIdAsync(textStyleIds[t]);
      if (ts && ts.type === "TEXT") {
        textStyleNames[textStyleIds[t]] = ts.name || "Style";
      }
    } catch (_) {}
  }

  var styleNames = {};
  var styleMeta = {};
  var styleColorHex = {};
  var styleColor = {};

  for (var s = 0; s < styleIds.length; s++) {
    try {
      var style = await figma.getStyleByIdAsync(styleIds[s]);
      if (style) {
        styleNames[styleIds[s]] = style.name;
        styleMeta[styleIds[s]] = style.remote ? "library" : "local";
        var paints = style.paints;
        var sp = Array.isArray(paints) ? getFirstSolidPaint(paints) : null;
        if (sp) {
          styleColorHex[styleIds[s]] = paintToHex(sp);
          styleColor[styleIds[s]] = sp.color;
        }
      } else {
        styleNames[styleIds[s]] = "Unknown style";
        styleMeta[styleIds[s]] = "unknown";
      }
    } catch (_) {
      styleNames[styleIds[s]] = "Unknown style";
      styleMeta[styleIds[s]] = "unknown";
    }
  }

  var variableNames = {};
  var variableColorHex = {};
  var variableColor = {};
  for (var v = 0; v < variableIds.length; v++) {
    try {
      var variable = await figma.variables.getVariableByIdAsync(variableIds[v]);
      if (variable) {
        variableNames[variableIds[v]] = variable.name || "Unnamed";
        if (variable.resolvedType === "COLOR" && variable.valuesByMode) {
          var modeIds = Object.keys(variable.valuesByMode);
          if (modeIds.length > 0) {
            var val = variable.valuesByMode[modeIds[0]];
            if (val && typeof val.r === "number") {
              variableColor[variableIds[v]] = val;
              variableColorHex[variableIds[v]] = paintToHex({ type: "SOLID", color: val });
            }
          }
        }
      } else {
        variableNames[variableIds[v]] = "Unknown variable";
      }
    } catch (_) {
      variableNames[variableIds[v]] = "Unknown variable";
    }
  }

  function textStyleSummary(items) {
    if (!items || items.length === 0) return { type: "none" };
    var first = items[0];
    var key = first.textStyleId ? "saved:" + (first.textStyleName || first.textStyleId) : "unsaved:" + (first.fontFamily || "") + "/" + (first.fontSize != null ? first.fontSize : "") + "/" + (first.fontWeight != null ? first.fontWeight : "");
    for (var i = 1; i < items.length; i++) {
      var it = items[i];
      var k = it.textStyleId ? "saved:" + (it.textStyleName || it.textStyleId) : "unsaved:" + (it.fontFamily || "") + "/" + (it.fontSize != null ? it.fontSize : "") + "/" + (it.fontWeight != null ? it.fontWeight : "");
      if (k !== key) return { type: "mixed" };
    }
    if (first.textStyleId) return { type: "saved", name: first.textStyleName || first.textStyleId };
    return { type: "unsaved", fontFamily: first.fontFamily, fontSize: first.fontSize, fontWeight: first.fontWeight };
  }

  var byColor = {};
  var byStyle = {};
  var byVariable = {};

  for (var j = 0; j < list.length; j++) {
    var t = list[j];
    var item = {
      id: t.id,
      name: t.name,
      textStyleId: t.textStyleId || null,
      textStyleName: t.textStyleId ? (textStyleNames[t.textStyleId] || null) : null,
      fontFamily: t.fontFamily || null,
      fontSize: t.fontSize != null ? t.fontSize : null,
      fontWeight: t.fontWeight != null ? t.fontWeight : null
    };

    if (t.type === "color") {
      var key = t.colorKey;
      if (!byColor[key]) {
        byColor[key] = { type: "color", colorHex: t.colorHex, color: t.color, items: [] };
      }
      byColor[key].items.push(item);
    } else if (t.type === "variable") {
      var vid = t.variableId;
      if (!byVariable[vid]) {
        byVariable[vid] = {
          type: "variable",
          variableId: vid,
          variableName: variableNames[vid] || vid,
          colorHex: variableColorHex[vid] || null,
          color: variableColor[vid] || null,
          items: []
        };
      }
      byVariable[vid].items.push(item);
    } else {
      var sid = t.styleId;
      if (!byStyle[sid]) {
        byStyle[sid] = {
          type: "style",
          styleId: sid,
          styleName: styleNames[sid] || sid,
          source: styleMeta[sid] || "unknown",
          colorHex: styleColorHex[sid] || null,
          color: styleColor[sid] || null,
          items: []
        };
      }
      byStyle[sid].items.push(item);
    }
  }

  var groups = [];
  var k;
  for (k in byColor) {
    byColor[k].textStyleSummary = textStyleSummary(byColor[k].items);
    groups.push(byColor[k]);
  }
  for (k in byStyle) {
    byStyle[k].textStyleSummary = textStyleSummary(byStyle[k].items);
    groups.push(byStyle[k]);
  }
  for (k in byVariable) {
    byVariable[k].textStyleSummary = textStyleSummary(byVariable[k].items);
    groups.push(byVariable[k]);
  }

  return { groups: groups };
}

// Node types that can have fills (excluding TEXT which is handled separately).
function hasFills(node) {
  if (!node) return false;
  try {
    if (node.type === "TEXT") return false;
    return typeof node.fills !== "undefined";
  } catch (_) { return false; }
}

// Returns raw list: { type:'color', colorKey, colorHex, color, id, name } or style/variable. No text-style fields.
function collectShapeLayersByFill(node) {
  var all = [];
  collectNodes(node, all);
  var list = [];
  for (var i = 0; i < all.length; i++) {
    var n = all[i];
    if (!hasFills(n)) continue;
    var name = n.name || "Unnamed";
    try {
      var fillStyleId = n.fillStyleId;
      if (fillStyleId === figma.mixed) continue;
      if (typeof fillStyleId === "string" && fillStyleId !== "") {
        list.push({ type: "style", styleId: fillStyleId, id: n.id, name: name });
        continue;
      }
      var fills = n.fills;
      if (fills === figma.mixed) continue;
      try {
        if (Array.isArray(fills) && fills.length > 0) {
          var p0 = fills[0];
          if (p0 && p0.boundVariables && p0.boundVariables.color && p0.boundVariables.color.id) {
            list.push({ type: "variable", variableId: p0.boundVariables.color.id, id: n.id, name: name });
            continue;
          }
        }
      } catch (_) {}
      var paints = Array.isArray(fills) ? fills : [];
      var paint = getFirstSolidPaint(paints);
      var colorKey = "__none";
      var colorHex = "No fill";
      var color = null;
      if (paint) {
        colorHex = paintToHex(paint);
        if (colorHex) {
          colorKey = colorHex;
          color = paint.color;
        }
      }
      list.push({ type: "color", colorKey: colorKey, colorHex: colorHex, color: color, id: n.id, name: name });
    } catch (_) {}
  }
  return list;
}

async function scanShapeLayersByFill(node) {
  var list = collectShapeLayersByFill(node);

  var styleIds = [];
  var variableIds = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i].type === "style" && list[i].styleId && styleIds.indexOf(list[i].styleId) === -1) styleIds.push(list[i].styleId);
    if (list[i].type === "variable" && list[i].variableId && variableIds.indexOf(list[i].variableId) === -1) variableIds.push(list[i].variableId);
  }

  var styleNames = {};
  var styleMeta = {};
  var styleColorHex = {};
  var styleColor = {};
  for (var s = 0; s < styleIds.length; s++) {
    try {
      var style = await figma.getStyleByIdAsync(styleIds[s]);
      if (style) {
        styleNames[styleIds[s]] = style.name;
        styleMeta[styleIds[s]] = style.remote ? "library" : "local";
        var paints = style.paints;
        var sp = Array.isArray(paints) ? getFirstSolidPaint(paints) : null;
        if (sp) {
          styleColorHex[styleIds[s]] = paintToHex(sp);
          styleColor[styleIds[s]] = sp.color;
        }
      } else {
        styleNames[styleIds[s]] = "Unknown style";
        styleMeta[styleIds[s]] = "unknown";
      }
    } catch (_) {
      styleNames[styleIds[s]] = "Unknown style";
      styleMeta[styleIds[s]] = "unknown";
    }
  }

  var variableNames = {};
  var variableColorHex = {};
  var variableColor = {};
  for (var v = 0; v < variableIds.length; v++) {
    try {
      var variable = await figma.variables.getVariableByIdAsync(variableIds[v]);
      if (variable) {
        variableNames[variableIds[v]] = variable.name || "Unnamed";
        if (variable.resolvedType === "COLOR" && variable.valuesByMode) {
          var modeIds = Object.keys(variable.valuesByMode);
          if (modeIds.length > 0) {
            var val = variable.valuesByMode[modeIds[0]];
            if (val && typeof val.r === "number") {
              variableColor[variableIds[v]] = val;
              variableColorHex[variableIds[v]] = paintToHex({ type: "SOLID", color: val });
            }
          }
        }
      } else {
        variableNames[variableIds[v]] = "Unknown variable";
      }
    } catch (_) {
      variableNames[variableIds[v]] = "Unknown variable";
    }
  }

  var byColor = {};
  var byStyle = {};
  var byVariable = {};
  for (var j = 0; j < list.length; j++) {
    var t = list[j];
    var item = { id: t.id, name: t.name };
    if (t.type === "color") {
      var key = t.colorKey;
      if (!byColor[key]) byColor[key] = { type: "color", colorHex: t.colorHex, color: t.color, items: [] };
      byColor[key].items.push(item);
    } else if (t.type === "variable") {
      var vid = t.variableId;
      if (!byVariable[vid]) {
        byVariable[vid] = {
          type: "variable",
          variableId: vid,
          variableName: variableNames[vid] || vid,
          colorHex: variableColorHex[vid] || null,
          color: variableColor[vid] || null,
          items: []
        };
      }
      byVariable[vid].items.push(item);
    } else {
      var sid = t.styleId;
      if (!byStyle[sid]) {
        byStyle[sid] = {
          type: "style",
          styleId: sid,
          styleName: styleNames[sid] || sid,
          source: styleMeta[sid] || "unknown",
          colorHex: styleColorHex[sid] || null,
          color: styleColor[sid] || null,
          items: []
        };
      }
      byStyle[sid].items.push(item);
    }
  }

  var groups = [];
  var k;
  for (k in byColor) groups.push(byColor[k]);
  for (k in byStyle) groups.push(byStyle[k]);
  for (k in byVariable) groups.push(byVariable[k]);
  return { groups: groups };
}

async function loadTextStyles() {
  var local = [];
  try {
    local = await figma.getLocalTextStylesAsync();
  } catch (_) {}
  if (!Array.isArray(local)) local = [];
  return local.map(function (s) { return { id: s.id, name: s.name }; });
}

// Collect all text style IDs used on the current page (including library styles), resolve to { id, name }.
async function loadTextStylesUsedOnPage() {
  var styleIds = [];
  var seen = {};
  function collectFromNode(node) {
    if (!node) return;
    try {
      if (node.type === "TEXT") {
        var len = node.characters ? node.characters.length : 0;
        if (len > 0) {
          var id = node.getRangeTextStyleId(0, len);
          if (id === figma.mixed) id = node.getRangeTextStyleId(0, 1);
          if (typeof id === "string" && id && !seen[id]) {
            seen[id] = true;
            styleIds.push(id);
          }
        }
      }
      var kids = node.children;
      if (kids && kids.length > 0) {
        for (var i = 0; i < kids.length; i++) collectFromNode(kids[i]);
      }
    } catch (_) {}
  }
  collectFromNode(figma.currentPage);
  var result = [];
  for (var i = 0; i < styleIds.length; i++) {
    try {
      var style = await figma.getStyleByIdAsync(styleIds[i]);
      if (style && style.type === "TEXT") {
        result.push({ id: style.id, name: style.name || "Unnamed" });
      }
    } catch (_) {}
  }
  return result;
}

// Collect paint style IDs used anywhere in the document (all pages), so all library colors appear in the selector.
function collectUsedPaintStyleIdsFromDocument() {
  var styleIds = [];
  var seen = {};
  function walk(node) {
    if (!node) return;
    try {
      if (node.type === "TEXT") {
        var len = node.characters ? node.characters.length : 0;
        if (len > 0) {
          var id = node.getRangeFillStyleId(0, len);
          if (id === figma.mixed && len > 0) id = node.getRangeFillStyleId(0, 1);
          if (typeof id === "string" && id && !seen[id]) { seen[id] = true; styleIds.push(id); }
        }
      } else if ("fillStyleId" in node && typeof node.fillStyleId === "string" && node.fillStyleId) {
        if (!seen[node.fillStyleId]) { seen[node.fillStyleId] = true; styleIds.push(node.fillStyleId); }
      }
      var kids = node.children;
      if (kids && kids.length > 0) for (var i = 0; i < kids.length; i++) walk(kids[i]);
    } catch (_) {}
  }
  var pages = figma.root && figma.root.children ? figma.root.children : [];
  for (var p = 0; p < pages.length; p++) walk(pages[p]);
  return Promise.resolve(styleIds);
}

// Только реально используемые paint styles из выделения (локальные и из библиотек)
async function collectUsedPaintStylesFromSelection() {
  var selection = figma.currentPage.selection;
  if (selection.length !== 1) return [];

  var node = selection[0];
  if (node.type !== "FRAME" && node.type !== "GROUP") return [];

  var all = [];
  collectNodes(node, all);

  var styleIds = [];
  var seen = {};
  for (var i = 0; i < all.length; i++) {
    var n = all[i];
    if (n.type !== "TEXT") continue;
    try {
      var len = n.characters ? n.characters.length : 0;
      if (!len) continue;
      var styleId = n.getRangeFillStyleId(0, len);
      if (typeof styleId === "string" && styleId && !seen[styleId]) {
        seen[styleId] = true;
        styleIds.push(styleId);
      }
    } catch (_) {}
  }

  var result = [];
  for (var s = 0; s < styleIds.length; s++) {
    var id = styleIds[s];
    try {
      var style = await figma.getStyleByIdAsync(id);
      if (style && style.type === "PAINT") {
        result.push({
          id: style.id,
          name: style.name,
          source: style.remote ? "library" : "local"
        });
      }
    } catch (_) {}
  }

  return result;
}

async function loadDocumentStyles() {
  var textStyles = await loadTextStyles();
  var paintStyles = await collectUsedPaintStylesFromSelection();
  return { textStyles: textStyles, paintStyles: paintStyles };
}

function findEmptyElements(node) {
  var all = [];
  collectNodes(node, all);
  var seen = {};
  var result = [];
  for (var i = 0; i < all.length; i++) {
    var n = all[i];
    if (n === node) continue;
    if (seen[n.id]) continue;
    var reason = null;
    var hasChildren = n.children && n.children.length > 0;
    var fillsEmpty = true;
    var strokesEmpty = true;
    if ("fills" in n && "strokes" in n) {
      try {
        var fills = n.fills;
        var strokes = n.strokes;
        fillsEmpty = fills === undefined || fills === figma.mixed || (Array.isArray(fills) && fills.length === 0);
        strokesEmpty = strokes === undefined || strokes === figma.mixed || (Array.isArray(strokes) && strokes.length === 0);
      } catch (_) {}
    }
    if ((n.type === "FRAME" || n.type === "GROUP") && !hasChildren) {
      if (fillsEmpty && strokesEmpty) {
        reason = "Empty frame/group";
      }
    }
    if (!reason && !hasChildren && n.opacity === 0) {
      reason = "Opacity 0";
    }
    if (!reason && !hasChildren && n.visible === false) {
      reason = "Hidden";
    }
    if (!reason && !hasChildren && n.type !== "TEXT" && fillsEmpty && strokesEmpty && ("fills" in n || "strokes" in n)) {
      reason = "Empty fill and stroke";
    }
    if (reason) {
      seen[n.id] = true;
      result.push({ id: n.id, name: n.name || "Unnamed", type: n.type, reason: reason });
    }
  }
  return result;
}

function runFindEmptyElements() {
  var selection = figma.currentPage.selection;
  if (selection.length !== 1) {
    figma.ui.postMessage({ type: "cleanerResult", error: "Select exactly one frame." });
    return;
  }
  var node = selection[0];
  if (node.type !== "FRAME") {
    figma.ui.postMessage({ type: "cleanerResult", error: "Select a frame." });
    return;
  }
  try {
    var items = findEmptyElements(node).filter(function (it) { return it.reason !== "Hidden"; });
    figma.ui.postMessage({ type: "cleanerResult", items: items });
  } catch (err) {
    figma.ui.postMessage({ type: "cleanerResult", error: (err && err.message) ? err.message : String(err) });
  }
}

function findDetachedComponents(node) {
  var all = [];
  collectNodes(node, all);
  var result = [];
  for (var i = 0; i < all.length; i++) {
    var n = all[i];
    if (n === node) continue;
    try {
      var info = n.detachedInfo;
      if (info && (info.type === "local" || info.type === "library")) {
        var source = info.type === "local" ? "Local" : "Library";
        var item = { id: n.id, name: n.name || "Unnamed", type: n.type, source: source };
        if (info.type === "library" && info.componentKey) item.parentComponentKey = info.componentKey;
        if (info.type === "local" && info.componentId) item.parentComponentId = info.componentId;
        result.push(item);
      }
    } catch (_) {}
  }
  return result;
}

function normalizeNameForMatch(s) {
  return (s || "").toLowerCase().trim().replace(/\s+/g, " ");
}

function nameSimilarity(a, b) {
  var na = normalizeNameForMatch(a);
  var nb = normalizeNameForMatch(b);
  if (na === nb) return 2;
  if (na.indexOf(nb) === 0 || nb.indexOf(na) === 0) return 1.5;
  if (na.indexOf(nb) >= 0 || nb.indexOf(na) >= 0) return 1;
  var minLen = Math.min(na.length, nb.length);
  var maxLen = Math.max(na.length, nb.length);
  var match = 0;
  for (var i = 0; i < minLen; i++) {
    if (na[i] === nb[i]) match++;
  }
  return match / maxLen;
}

function suggestLibraryComponentsForName(detachedName, libraryComponents) {
  if (!libraryComponents || libraryComponents.length === 0) return [];
  var scored = [];
  for (var i = 0; i < libraryComponents.length; i++) {
    var c = libraryComponents[i];
    var compName = (c.name != null ? c.name : c.key || "").trim();
    if (!compName) continue;
    var score = nameSimilarity(detachedName, compName);
    if (score > 0) scored.push({ key: c.key, name: compName, score: score });
  }
  scored.sort(function (a, b) { return b.score - a.score; });
  var out = [];
  var seen = {};
  for (var j = 0; j < scored.length && out.length < 10; j++) {
    if (!seen[scored[j].key]) {
      seen[scored[j].key] = true;
      out.push({ key: scored[j].key, name: scored[j].name });
    }
  }
  return out;
}

// Build suggestions for a detached item: parent component first (from detachedInfo), then name-based.
function getSuggestionsForDetachedItem(item, libraryComponents) {
  if (!libraryComponents || libraryComponents.length === 0) return [];
  var out = [];
  var seen = {};
  if (item.parentComponentKey) {
    for (var i = 0; i < libraryComponents.length; i++) {
      var c = libraryComponents[i];
      if (c.key === item.parentComponentKey) {
        var name = (c.name != null ? c.name : c.key || "").trim();
        out.push({ key: c.key, name: name || c.key });
        seen[c.key] = true;
        break;
      }
    }
  }
  if (item.parentComponentId) {
    try {
      var parentComp = figma.getNodeById(item.parentComponentId);
      if (parentComp && !parentComp.removed && (parentComp.type === "COMPONENT" || parentComp.type === "COMPONENT_SET")) {
        var parentName = (parentComp.name != null ? parentComp.name : "").trim();
        if (parentName) {
          for (var k = 0; k < libraryComponents.length; k++) {
            var cc = libraryComponents[k];
            var cn = (cc.name != null ? cc.name : cc.key || "").trim();
            if (cn === parentName || nameSimilarity(parentName, cn) >= 1.5) {
              if (!seen[cc.key]) {
                seen[cc.key] = true;
                out.push({ key: cc.key, name: cn });
              }
              break;
            }
          }
        }
      }
    } catch (_) {}
  }
  var byName = suggestLibraryComponentsForName(item.name, libraryComponents);
  for (var n = 0; n < byName.length && out.length < 10; n++) {
    if (!seen[byName[n].key]) {
      seen[byName[n].key] = true;
      out.push(byName[n]);
    }
  }
  return out;
}

// Find an instance in the document we can clone (same component key). Returns { instance, component } or null.
function findInstanceOrComponentByKey(componentKey) {
  var key = (componentKey || "").trim();
  if (!key) return Promise.resolve(null);
  var loadPages = figma.loadAllPagesAsync && typeof figma.loadAllPagesAsync === "function"
    ? figma.loadAllPagesAsync()
    : Promise.resolve();
  return loadPages.then(function () {
    var instances = [];
    try {
      if (figma.root && figma.root.findAllWithCriteria) {
        instances = figma.root.findAllWithCriteria({ types: ["INSTANCE"] });
      }
    } catch (_) {}
    var idx = 0;
    return new Promise(function (resolve) {
      function next() {
        if (idx >= instances.length) {
          resolve(null);
          return;
        }
        var inst = instances[idx];
        idx++;
        if (!inst || inst.removed) {
          next();
          return;
        }
        function onMain(main) {
          if (!main || main.removed) {
            next();
            return;
          }
          var k = (main.key != null ? main.key : "").trim();
          if (k === key) {
            resolve({ instance: inst, component: main });
            return;
          }
          if (main.parent && main.parent.type === "COMPONENT_SET") {
            var set = main.parent;
            var setKey = (set.key != null ? set.key : "").trim();
            if (setKey === key) {
              resolve({ instance: inst, component: main });
              return;
            }
          }
          next();
        }
        if (typeof inst.getMainComponentAsync === "function") {
          inst.getMainComponentAsync().then(onMain).catch(function () { next(); });
        } else {
          try {
            onMain(inst.mainComponent);
          } catch (_) {
            next();
          }
        }
      }
      next();
    });
  });
}

// Collect library components from instances on all pages (no getAvailableLibraryComponentsAsync in plugin API).
function collectLibraryComponentsFromDocument() {
  var loadPages = figma.loadAllPagesAsync && typeof figma.loadAllPagesAsync === "function"
    ? figma.loadAllPagesAsync()
    : Promise.resolve();
  return loadPages.then(function () {
    var instances = [];
    try {
      var pages = figma.root && figma.root.children ? figma.root.children : [];
      for (var p = 0; p < pages.length; p++) {
        if (pages[p].findAllWithCriteria) {
          var onPage = pages[p].findAllWithCriteria({ types: ["INSTANCE"] });
          for (var i = 0; i < onPage.length; i++) instances.push(onPage[i]);
        }
      }
    } catch (_) {}
    if (instances.length === 0) return Promise.resolve([]);
  var byKey = {};
  var idx = 0;
  return new Promise(function (resolve) {
    function addFromMain(main) {
      if (!main || main.removed) return;
      if (main.type === "INSTANCE") return;
      if (main.type !== "COMPONENT" && main.type !== "COMPONENT_SET") return;
      if (main.remote !== true && (main.key == null || main.key === "")) return;
      var key = main.key != null ? main.key : "";
      var name;
      var dedupeKey = key;
      var useKey = key;
      if (main.parent && main.parent.type === "COMPONENT_SET") {
        var set = main.parent;
        name = (set.name != null ? set.name : main.name || "Component").trim();
        dedupeKey = (set.key != null ? set.key : set.id) + "";
        useKey = key;
      } else {
        name = (main.name != null ? main.name : key || "Component").trim();
        dedupeKey = key;
      }
      if (useKey && !byKey[dedupeKey]) byKey[dedupeKey] = { key: useKey, name: name };
    }
    function next() {
      if (idx >= instances.length) {
        var list = [];
        for (var k in byKey) list.push(byKey[k]);
        resolve(list);
        return;
      }
      var inst = instances[idx];
      idx++;
      if (inst.removed) { next(); return; }
      if (inst.getMainComponentAsync && typeof inst.getMainComponentAsync === "function") {
        inst.getMainComponentAsync().then(function (main) {
          addFromMain(main);
          next();
        }).catch(function () { next(); });
      } else {
        try {
          addFromMain(inst.mainComponent);
        } catch (_) {}
        next();
      }
    }
    next();
  });
  });
}

function runParseComponents() {
  var loadPages = figma.loadAllPagesAsync && typeof figma.loadAllPagesAsync === "function"
    ? figma.loadAllPagesAsync()
    : Promise.resolve();
  loadPages.then(function () {
    var local = [];
    try {
      if (figma.root && figma.root.findAllWithCriteria) {
        var compNodes = figma.root.findAllWithCriteria({ types: ["COMPONENT"] });
        var setNodes = figma.root.findAllWithCriteria({ types: ["COMPONENT_SET"] });
        for (var i = 0; i < compNodes.length; i++) {
          var n = compNodes[i];
          if (!n || n.removed || n.type !== "COMPONENT") continue;
          var par = n.parent;
          if (par && par.type === "COMPONENT_SET") continue;
          local.push({ id: n.id, name: (n.name != null ? n.name : "Unnamed").trim() });
        }
        for (var s = 0; s < setNodes.length; s++) {
          var set = setNodes[s];
          if (!set || set.removed || set.type !== "COMPONENT_SET") continue;
          local.push({ id: set.id, name: (set.name != null ? set.name : "Unnamed").trim() });
        }
      }
    } catch (e) {
      figma.ui.postMessage({ type: "parseComponentsResult", error: (e && e.message) ? e.message : String(e) });
      return;
    }
    collectLibraryComponentsFromDocument().then(function (library) {
      figma.ui.postMessage({ type: "parseComponentsResult", local: local, library: library });
    }).catch(function (e) {
      figma.ui.postMessage({ type: "parseComponentsResult", local: local, library: [], error: (e && e.message) ? e.message : String(e) });
    });
  }).catch(function (e) {
    figma.ui.postMessage({ type: "parseComponentsResult", error: (e && e.message) ? e.message : String(e) });
  });
}

function runFindDetached() {
  var selection = figma.currentPage.selection;
  if (selection.length !== 1) {
    figma.ui.postMessage({ type: "detachResult", error: "Select exactly one frame or section." });
    return;
  }
  var node = selection[0];
  if (node.type !== "FRAME" && node.type !== "SECTION") {
    figma.ui.postMessage({ type: "detachResult", error: "Select a frame or section." });
    return;
  }
  try {
    var items = findDetachedComponents(node);
    collectLibraryComponentsFromDocument().then(function (libComponents) {
      for (var i = 0; i < items.length; i++) {
        items[i].suggestions = getSuggestionsForDetachedItem(items[i], libComponents);
      }
      figma.ui.postMessage({ type: "detachResult", items: items });
    }).catch(function () {
      figma.ui.postMessage({ type: "detachResult", items: items });
    });
  } catch (err) {
    figma.ui.postMessage({ type: "detachResult", error: (err && err.message) ? err.message : String(err) });
  }
}

function runReplaceDetached(replacements) {
  if (!replacements || !Array.isArray(replacements) || replacements.length === 0) {
    figma.ui.postMessage({ type: "replaceDetachedResult", error: "No replacements selected." });
    return;
  }
  var DEBUG = true;
  function dbg(msg) {
    if (DEBUG) figma.notify("[Detach] " + msg);
    figma.ui.postMessage({ type: "replaceDetachDebug", message: msg });
  }
  var idx = 0;
  function next() {
    if (idx >= replacements.length) {
      figma.ui.postMessage({ type: "replaceDetachedResult", replaced: replacements.length });
      figma.notify("Replaced " + replacements.length + " detached component(s)");
      return;
    }
    var r = replacements[idx];
    var nodeId = r.nodeId;
    var componentKey = (r.componentKey || "").trim();
    if (!nodeId || !componentKey) {
      dbg("Skip: missing nodeId or componentKey");
      idx++; next(); return;
    }
    dbg("Step 1: get node");
    figma.getNodeByIdAsync(nodeId).then(function (node) {
      if (!node || node.removed) {
        dbg("Step 1 fail: node not found");
        idx++; next(); return;
      }
      var parent = node.parent;
      if (!parent || !("appendChild" in parent)) {
        dbg("Step 1 fail: parent no appendChild");
        idx++; next(); return;
      }
      var childIndex = parent.children.indexOf(node);
      if (childIndex < 0) childIndex = parent.children.length;
      var x = node.x;
      var y = node.y;
      var width = node.width;
      var height = node.height;
      var rotation = node.rotation;
      var textContents = collectTextContentsFromNode(node);
      function done() { idx++; next(); }
      function fail(errMsg) {
        dbg("Error: " + errMsg);
        figma.ui.postMessage({ type: "replaceDetachedResult", error: errMsg });
        done();
      }
      function placeNewInstance(instance) {
        if (!instance || instance.removed) { done(); return; }
        try {
          dbg("Step 4: place instance");
          instance.x = x;
          instance.y = y;
          try {
            if (typeof rotation === "number") instance.rotation = rotation;
          } catch (_) {}
          node.remove();
          if (typeof parent.insertChild === "function") {
            parent.insertChild(childIndex, instance);
          } else {
            parent.appendChild(instance);
          }
          try {
            if (typeof instance.resize === "function" && typeof width === "number" && typeof height === "number" && width >= 0.01 && height >= 0.01) {
              instance.resize(width, height);
            }
          } catch (_) {}
          if (textContents && textContents.length > 0) {
            dbg("Step 5: apply text");
            applyTextContentsToInstance(instance, textContents).then(function () {
              dbg("Step 6: done");
              done();
            }).catch(function (e) {
              fail((e && e.message) ? e.message : String(e));
            });
          } else {
            dbg("Step 5: done");
            done();
          }
        } catch (e) {
          fail((e && e.message) ? e.message : String(e));
        }
      }
      dbg("Step 2: lookup key");
      findInstanceOrComponentByKey(componentKey).then(function (found) {
        if (found && found.instance) {
          dbg("Step 3: found instance");
          try {
            var clone = found.instance.clone();
            placeNewInstance(clone);
          } catch (e) {
            try {
              var comp = found.component;
              if (comp && typeof comp.createInstance === "function") {
                placeNewInstance(comp.createInstance());
              } else {
                fail((e && e.message) ? e.message : String(e));
              }
            } catch (e2) {
              fail((e2 && e2.message) ? e2.message : String(e2));
            }
          }
          return;
        }
        if (found && found.component) {
          dbg("Step 3: found component");
          try {
            placeNewInstance(found.component.createInstance());
          } catch (e) {
            fail((e && e.message) ? e.message : String(e));
          }
          return;
        }
        dbg("Step 3: not in doc, try import");
        if (typeof figma.importComponentByKeyAsync === "function") {
          figma.importComponentByKeyAsync(componentKey).then(function (component) {
            if (component && typeof component.createInstance === "function") {
              placeNewInstance(component.createInstance());
            } else {
              fail("Component not found in file. Place an instance of that component somewhere first.");
            }
          }).catch(function (err) {
            fail("Import failed: " + (err && err.message ? err.message : String(err)));
          });
        } else {
          fail("Component not found in document. Place an instance of that component in the file first.");
        }
      }).catch(function (err) {
        fail("Lookup failed: " + (err && err.message ? err.message : String(err)));
      });
    }).catch(function (err) {
      dbg("getNodeById failed: " + (err && err.message ? err.message : ""));
      idx++;
      next();
    });
  }
  next();
}

function runReplaceLocalWithLibrary(replacements) {
  if (!replacements || !Array.isArray(replacements) || replacements.length === 0) {
    figma.ui.postMessage({ type: "replaceLocalWithLibraryResult", error: "No replacements selected." });
    return;
  }
  var loadPages = figma.loadAllPagesAsync && typeof figma.loadAllPagesAsync === "function"
    ? figma.loadAllPagesAsync()
    : Promise.resolve();
  loadPages.then(function () {
    var instances = [];
    try {
      if (figma.root && figma.root.findAllWithCriteria) {
        instances = figma.root.findAllWithCriteria({ types: ["INSTANCE"] });
      }
    } catch (_) {}
    var toReplace = [];
    var idx = 0;
    function checkNext() {
      if (idx >= instances.length) {
        doReplace(toReplace);
        return;
      }
      var inst = instances[idx];
      idx++;
      if (!inst || inst.removed) {
        checkNext();
        return;
      }
      function onMain(main) {
        tryAdd(inst, main);
        checkNext();
      }
      if (typeof inst.getMainComponentAsync === "function") {
        inst.getMainComponentAsync().then(onMain).catch(function () { checkNext(); });
      } else {
        tryAdd(inst, inst.mainComponent);
        checkNext();
      }
    }
    function tryAdd(inst, main) {
      if (!main || main.removed) return;
      for (var r = 0; r < replacements.length; r++) {
        var compId = replacements[r].componentId;
        var componentKey = replacements[r].componentKey;
        if (!compId || !componentKey) continue;
        var match = (main.id === compId) || (main.parent && main.parent.id === compId);
        if (match) {
          toReplace.push({ nodeId: inst.id, componentKey: componentKey });
          break;
        }
      }
    }
    checkNext();
  });

  function doReplace(pairs) {
    if (pairs.length === 0) {
      figma.ui.postMessage({ type: "replaceLocalWithLibraryResult", replaced: 0 });
      figma.notify("No instances to replace.");
      return;
    }
    var i = 0;
    function next() {
      if (i >= pairs.length) {
        figma.ui.postMessage({ type: "replaceLocalWithLibraryResult", replaced: pairs.length });
        figma.notify("Replaced " + pairs.length + " instance(s) with library component(s).");
        return;
      }
      var r = pairs[i];
      figma.getNodeByIdAsync(r.nodeId).then(function (node) {
        if (!node || node.removed) {
          i++;
          next();
          return;
        }
        var parent = node.parent;
        if (!parent || !("appendChild" in parent)) {
          i++;
          next();
          return;
        }
        var childIndex = parent.children.indexOf(node);
        if (childIndex < 0) childIndex = parent.children.length;
        var x = node.x;
        var y = node.y;
        var width = node.width;
        var height = node.height;
        var rotation = node.rotation;
        node.remove();
        figma.importComponentByKeyAsync(r.componentKey).then(function (component) {
          if (!component || component.removed) {
            i++;
            next();
            return;
          }
          var instance = component.createInstance();
          instance.x = x;
          instance.y = y;
          try {
            if (typeof rotation === "number") instance.rotation = rotation;
          } catch (_) {}
          if (typeof parent.insertChild === "function") {
            parent.insertChild(childIndex, instance);
          } else {
            parent.appendChild(instance);
          }
          i++;
          next();
        }).catch(function () {
          i++;
          next();
        });
      }).catch(function () {
        i++;
        next();
      });
    }
    next();
  }
}

async function runScan() {
  var selection = figma.currentPage.selection;
  if (selection.length !== 1) {
    figma.ui.postMessage({ type: "scanResult", error: "Select exactly one frame or group." });
    return;
  }
  var node = selection[0];
  if (node.type !== "FRAME" && node.type !== "GROUP") {
    figma.ui.postMessage({ type: "scanResult", error: "Select a frame or group." });
    return;
  }
  try {
    var data = await scanTextLayersByFill(node);
    figma.ui.postMessage({ type: "scanResult", data: data });
  } catch (err) {
    figma.ui.postMessage({ type: "scanResult", error: (err && err.message) ? err.message : String(err) });
  }
}

var PLUGIN_SIZE = { width: 760, height: 640 };
var PLUGIN_SIZE_MIN = { width: 200, height: 48 };

function postSelectionFramesCount() {
  var selection = figma.currentPage.selection;
  var frames = selection.filter(function (n) { return n && !n.removed && n.type === "FRAME"; });
  figma.ui.postMessage({ type: "selectionFramesCount", count: frames.length });
}

/** Bottom-to-top layer panel order on the current page (siblings: lower z / lower in list first). */
function sortFramesByLayerPanelOrder(frames, page) {
  var set = {};
  for (var i = 0; i < frames.length; i++) set[frames[i].id] = true;
  var ordered = [];
  function walk(n) {
    if (set[n.id]) ordered.push(n);
    if (!n.children) return;
    for (var c = 0; c < n.children.length; c++) walk(n.children[c]);
  }
  var kids = page.children;
  for (var j = 0; j < kids.length; j++) walk(kids[j]);
  if (ordered.length < frames.length) {
    for (var k = 0; k < frames.length; k++) {
      if (ordered.indexOf(frames[k]) === -1) ordered.push(frames[k]);
    }
  }
  return ordered;
}

figma.showUI(__html__, { width: PLUGIN_SIZE.width, height: PLUGIN_SIZE.height });
postSelectionFramesCount();
figma.on("selectionchange", postSelectionFramesCount);

figma.ui.onmessage = function (msg) {
  if (msg.type === "resize") {
    var w = msg.width;
    var h = msg.height;
    if (typeof w === "number" && typeof h === "number" && w > 0 && h > 0) {
      figma.ui.resize(Math.min(w, 4000), Math.min(h, 4000));
    }
    return;
  }
  if (msg.type === "close") {
    figma.closePlugin();
    return;
  }
  if (msg.type === "load") {
    loadDocumentStyles().then(function (data) {
      figma.ui.postMessage({ type: "documentStyles", textStyles: data.textStyles, paintStyles: data.paintStyles });
    });
    return;
  }
  if (msg.type === "scan") {
    runScan();
    return;
  }
  if (msg.type === "scanLayers") {
    (function () {
      var selection = figma.currentPage.selection;
      if (selection.length !== 1) {
        figma.ui.postMessage({ type: "scanLayersResult", error: "Select exactly one frame or group." });
        return;
      }
      var node = selection[0];
      if (node.type !== "FRAME" && node.type !== "GROUP") {
        figma.ui.postMessage({ type: "scanLayersResult", error: "Select a frame or group." });
        return;
      }
      scanShapeLayersByFill(node).then(function (data) {
        figma.ui.postMessage({ type: "scanLayersResult", data: data });
      }).catch(function (err) {
        figma.ui.postMessage({ type: "scanLayersResult", error: (err && err.message) ? err.message : String(err) });
      });
    })();
    return;
  }
  if (msg.type === "findEmptyElements") {
    runFindEmptyElements();
    return;
  }
  if (msg.type === "findDetached") {
    runFindDetached();
    return;
  }
  if (msg.type === "parseComponents") {
    runParseComponents();
    return;
  }
  if (msg.type === "replaceDetached") {
    runReplaceDetached(msg.replacements);
    return;
  }
  if (msg.type === "replaceLocalWithLibrary") {
    runReplaceLocalWithLibrary(msg.replacements);
    return;
  }
  if (msg.type === "grabComments") {
    var token = (msg.token || "").trim();
    if (!token) {
      figma.ui.postMessage({ type: "commentsResult", error: "No token provided." });
      return;
    }
    var rawKey = (msg.fileKey && msg.fileKey.trim()) ? msg.fileKey.trim() : (figma.fileKey || null);
    if (!rawKey) {
      figma.ui.postMessage({
        type: "commentsResult",
        error: "File key not available. Paste it from the file URL: open the file in the browser and copy the part after figma.com/file/ or figma.com/design/ (e.g. AbCdEf123)."
      });
      return;
    }
    var fileKey = rawKey;
    if (rawKey.indexOf("figma.com") >= 0) {
      var match = rawKey.match(/\/(?:file|design)\/([a-zA-Z0-9_-]+)/);
      if (match && match[1]) fileKey = match[1];
    } else {
      var q = rawKey.indexOf("?");
      if (q >= 0) rawKey = rawKey.slice(0, q);
      fileKey = rawKey.replace(/^\/+|\/+$/g, "").split("/")[0] || rawKey;
    }
    if (!fileKey) {
      figma.ui.postMessage({ type: "commentsResult", error: "Could not parse file key from the pasted value." });
      return;
    }
    var pageNodeIds = {};
    var list = [];
    collectNodes(figma.currentPage, list);
    for (var i = 0; i < list.length; i++) {
      pageNodeIds[list[i].id] = true;
    }
    fetch("https://api.figma.com/v1/files/" + fileKey + "/comments", {
      method: "GET",
      headers: { "X-Figma-Token": token }
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var errMsg = (data && data.message) ? data.message : "Failed to load comments (" + res.status + ").";
          if (res.status === 404) {
            errMsg = "File not found (404). Check that the file key is correct (from the file URL in the browser), the file is saved in Figma, and your token has access to it.";
          } else if (res.status === 403) {
            errMsg = "Access denied (403). Check your token and ensure it has the file_comments:read scope.";
          }
          figma.ui.postMessage({ type: "commentsResult", error: errMsg });
          return;
        }
        var all = (data && data.comments) ? data.comments : [];
        var onPage = [];
        for (var j = 0; j < all.length; j++) {
          var c = all[j];
          var nodeId = c.client_meta && c.client_meta.node_id;
          if (nodeId && pageNodeIds[nodeId]) onPage.push(c);
        }
        figma.ui.postMessage({ type: "commentsResult", comments: onPage });
      });
    }).catch(function (err) {
      figma.ui.postMessage({
        type: "commentsResult",
        error: (err && err.message) ? err.message : "Network error."
      });
    });
    return;
  }
  if (msg.type === "selectNode") {
    var id = msg.id;
    if (!id) return;
    figma.getNodeByIdAsync(id).then(function (target) {
      if (target && !target.removed) {
        figma.currentPage.selection = [target];
      }
    });
    return;
  }
  if (msg.type === "selectNodes") {
    var ids = msg.ids;
    if (!ids || !Array.isArray(ids)) return;
    var zoom = figma.viewport.zoom;
    var centerX = figma.viewport.center.x;
    var centerY = figma.viewport.center.y;
    var promises = ids.map(function (id) { return figma.getNodeByIdAsync(id); });
    Promise.all(promises).then(function (nodes) {
      var valid = nodes.filter(function (n) { return n && !n.removed; });
      if (valid.length > 0) figma.currentPage.selection = valid;
      figma.viewport.zoom = zoom;
      figma.viewport.center = { x: centerX, y: centerY };
    });
    return;
  }
  if (msg.type === "extractTextKeyValues") {
    (function () {
      var selection = figma.currentPage.selection;
      if (!selection || selection.length !== 1) {
        figma.ui.postMessage({ type: "textKeyValuesResult", error: "Select exactly one frame." });
        return;
      }
      var frame = selection[0];
      if (!frame || frame.removed || frame.type !== "FRAME") {
        figma.ui.postMessage({ type: "textKeyValuesResult", error: "Selected node must be a FRAME." });
        return;
      }
      var items = collectTextKeyValuesFromFrame(frame);
      figma.ui.postMessage({ type: "textKeyValuesResult", frameId: frame.id, items: items });
    })();
    return;
  }
  if (msg.type === "captureFrameImageForLlm") {
    (function () {
      var frameId = msg.frameId;
      if (!frameId || typeof frameId !== "string") {
        figma.ui.postMessage({ type: "frameImageForLlmResult", error: "Missing frameId. Extract first." });
        return;
      }
      figma.getNodeByIdAsync(frameId).then(function (frame) {
        if (!frame || frame.removed || frame.type !== "FRAME") {
          figma.ui.postMessage({ type: "frameImageForLlmResult", error: "Frame not found (or selection changed). Extract again." });
          return;
        }
        var exportSettings = { format: "PNG", constraint: { type: "SCALE", value: 1 } };
        frame.exportAsync(exportSettings).then(function (bytes) {
          var base64 = uint8ArrayToBase64(bytes);
          if (!base64) {
            figma.ui.postMessage({ type: "frameImageForLlmResult", error: "Failed to encode frame image." });
            return;
          }
          figma.ui.postMessage({
            type: "frameImageForLlmResult",
            frameId: frame.id,
            frameName: frame.name || "Frame",
            imageDataUrl: "data:image/png;base64," + base64
          });
        }).catch(function (err) {
          figma.ui.postMessage({
            type: "frameImageForLlmResult",
            error: (err && err.message) ? err.message : "Failed to export frame image."
          });
        });
      }).catch(function () {
        figma.ui.postMessage({ type: "frameImageForLlmResult", error: "Failed to load frame." });
      });
    })();
    return;
  }
  if (msg.type === "updateTextKeyValues") {
    (function () {
      var frameId = msg.frameId;
      var updates = msg.updates;
      if (!frameId || typeof frameId !== "string") {
        figma.ui.postMessage({ type: "textKeyValuesUpdated", error: "Missing frameId. Extract first." });
        return;
      }
      if (!updates || !Array.isArray(updates) || updates.length === 0) {
        figma.ui.postMessage({ type: "textKeyValuesUpdated", error: "No updates provided." });
        return;
      }

      figma.getNodeByIdAsync(frameId).then(function (frame) {
        if (!frame || frame.removed || frame.type !== "FRAME") {
          figma.ui.postMessage({ type: "textKeyValuesUpdated", error: "Frame not found (or selection changed). Extract again." });
          return;
        }
        var allowedTextIds = collectTextNodeIdsFromFrame(frame);

        var i = 0;
        var updated = 0;
        var attempted = 0;
        var skipped = 0;

        function next() {
          if (i >= updates.length) {
            figma.ui.postMessage({ type: "textKeyValuesUpdated", frameId: frameId, updated: updated, attempted: attempted, skipped: skipped });
            return;
          }

          var u = updates[i];
          i++;
          if (!u || typeof u.id !== "string") {
            skipped++;
            next();
            return;
          }
          if (!allowedTextIds[u.id]) {
            skipped++;
            next();
            return;
          }

          attempted++;
          figma.getNodeByIdAsync(u.id).then(function (node) {
            if (!node || node.removed || node.type !== "TEXT") { skipped++; next(); return; }

            var newValue = u.value != null ? (typeof u.value === "string" ? u.value : String(u.value)) : "";
            loadFontForTextNodeIfPossible(node).then(function () {
              try {
                node.characters = newValue;
                updated++;
              } catch (_) {}
              next();
            }).catch(function () {
              next();
            });
          }).catch(function () {
            next();
          });
        }

        next();
      }).catch(function () {
        figma.ui.postMessage({ type: "textKeyValuesUpdated", error: "Failed to load frame." });
      });
    })();
    return;
  }
  if (msg.type === "getStylesAndVariables") {
    (function () {
      var paintStyles = [];
      var textStyles = [];
      var variablesFlat = [];
      function sendResult() {
        figma.ui.postMessage({ type: "stylesAndVariablesResult", paintStyles: paintStyles, textStyles: textStyles, variables: variablesFlat });
      }
      function loadLibraryVariablesThenSend() {
        try {
          if (!figma.teamLibrary) {
            try { figma.notify("Library colors: add \"teamlibrary\" to plugin permissions and reload.", { timeout: 4000 }); } catch (_) {}
            sendResult();
            return;
          }
          var getCollections = figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync;
          if (typeof getCollections !== "function") {
            sendResult();
            return;
          }
          getCollections.call(figma.teamLibrary).then(function (libColls) {
            if (!libColls || libColls.length === 0) {
              sendResult();
              return;
            }
            var cIdx = 0;
            function nextColl() {
              if (cIdx >= libColls.length) {
                sendResult();
                return;
              }
              var coll = libColls[cIdx];
              var collectionKey = coll.key != null ? coll.key : coll.id;
              if (!collectionKey) {
                cIdx++;
                nextColl();
                return;
              }
              var getVars = figma.teamLibrary.getVariablesInLibraryCollectionAsync;
              if (typeof getVars !== "function") {
                sendResult();
                return;
              }
              getVars.call(figma.teamLibrary, collectionKey).then(function (vars) {
                if (!vars || vars.length === 0) {
                  cIdx++;
                  nextColl();
                  return;
                }
                var colorVars = [];
                for (var i = 0; i < vars.length; i++) {
                  if (vars[i] && vars[i].resolvedType === "COLOR") colorVars.push(vars[i]);
                }
                var vi = 0;
                function nextLibVar() {
                  if (vi >= colorVars.length) {
                    cIdx++;
                    nextColl();
                    return;
                  }
                  var v = colorVars[vi];
                  var varKey = v.key != null ? v.key : v.id;
                  if (!varKey) {
                    vi++;
                    nextLibVar();
                    return;
                  }
                  var importVar = figma.variables.importVariableByKeyAsync;
                  if (typeof importVar !== "function") {
                    variablesFlat.push({ key: varKey, name: v.name || "Unnamed", hex: null, source: "library" });
                    vi++;
                    nextLibVar();
                    return;
                  }
                  importVar.call(figma.variables, varKey).then(function (imported) {
                    if (imported && imported.resolvedType === "COLOR") {
                      var hex = null;
                      if (imported.valuesByMode) {
                        var modeIds = Object.keys(imported.valuesByMode);
                        if (modeIds.length > 0) {
                          var val = imported.valuesByMode[modeIds[0]];
                          if (val && typeof val.r === "number") hex = paintToHex({ type: "SOLID", color: val });
                        }
                      }
                      variablesFlat.push({
                        id: imported.id,
                        key: imported.key != null ? imported.key : varKey,
                        name: imported.name || "Unnamed",
                        hex: hex || null,
                        source: "library"
                      });
                    }
                    vi++;
                    nextLibVar();
                  }).catch(function () {
                    variablesFlat.push({ key: varKey, name: v.name || "Unnamed", hex: null, source: "library" });
                    vi++;
                    nextLibVar();
                  });
                }
                nextLibVar();
              }).catch(function () { cIdx++; nextColl(); });
            }
            nextColl();
          }).catch(function (err) {
            sendResult();
          });
        } catch (e) {
          sendResult();
        }
      }
      function loadVariables() {
        if (!figma.variables || typeof figma.variables.getLocalVariableCollectionsAsync !== "function") {
          loadLibraryVariablesThenSend();
          return;
        }
        figma.variables.getLocalVariableCollectionsAsync().then(function (collections) {
          if (!collections || collections.length === 0) {
            loadLibraryVariablesThenSend();
            return;
          }
          var idx = 0;
          function next() {
            if (idx >= collections.length) {
              loadLibraryVariablesThenSend();
              return;
            }
            var coll = collections[idx];
            var ids = coll.variableIds || [];
            var vi = 0;
            function nextVar() {
              if (vi >= ids.length) {
                idx++;
                next();
                return;
              }
              figma.variables.getVariableByIdAsync(ids[vi]).then(function (v) {
                if (v && v.resolvedType === "COLOR") {
                  var hex = null;
                  if (v.valuesByMode) {
                    var modeIds = Object.keys(v.valuesByMode);
                    if (modeIds.length > 0) {
                      var val = v.valuesByMode[modeIds[0]];
                      if (val && typeof val.r === "number") hex = paintToHex({ type: "SOLID", color: val });
                    }
                  }
                  variablesFlat.push({ id: v.id, name: v.name || "Unnamed", hex: hex || null, source: "local" });
                }
                vi++;
                nextVar();
              }).catch(function () { vi++; nextVar(); });
            }
            nextVar();
          }
          next();
        }).catch(function () { loadLibraryVariablesThenSend(); });
      }
      var paintPromise = typeof figma.getLocalPaintStylesAsync === "function"
        ? figma.getLocalPaintStylesAsync()
        : (typeof figma.getLocalPaintStyles === "function" ? Promise.resolve(figma.getLocalPaintStyles()) : Promise.resolve([]));
      function styleToItem(s) {
        var sp = getFirstSolidPaint(s.paints);
        var hex = sp ? paintToHex(sp) : null;
        var source = s.remote === true ? "library" : "local";
        return { id: s.id, name: s.name || "Unnamed", hex: hex || null, source: source };
      }
      var textPromise = typeof figma.getLocalTextStylesAsync === "function"
        ? figma.getLocalTextStylesAsync()
        : Promise.resolve([]);

      Promise.all([paintPromise, textPromise]).then(function (results) {
        var styles = results[0];
        var tStyles = results[1] || [];
        var byId = {};
        if (styles && styles.length) {
          for (var si = 0; si < styles.length; si++) {
            var it = styleToItem(styles[si]);
            paintStyles.push(it);
            byId[it.id] = true;
          }
        }
        if (paintStyles.length === 0 && typeof figma.getSelectionColors === "function") {
          try {
            var selColors = figma.getSelectionColors();
            if (selColors && selColors.styles && selColors.styles.length) {
              for (var i = 0; i < selColors.styles.length; i++) {
                var st = selColors.styles[i];
                if (st && st.id && !byId[st.id]) {
                  byId[st.id] = true;
                  paintStyles.push(styleToItem(st));
                }
              }
            }
          } catch (_) {}
        }
        var paintMergeDone = collectUsedPaintStyleIdsFromDocument().then(function (usedIds) {
          return new Promise(function (resolve) {
            function next(idx) {
              if (idx >= usedIds.length) { resolve(); return; }
              var id = usedIds[idx];
              if (byId[id]) { next(idx + 1); return; }
              figma.getStyleByIdAsync(id).then(function (style) {
                if (style && style.type === "PAINT") {
                  byId[style.id] = true;
                  paintStyles.push(styleToItem(style));
                }
                next(idx + 1);
              }).catch(function () { next(idx + 1); });
            }
            next(0);
          });
        });
        var localTextStyles = (tStyles || []).map(function (s) { return { id: s.id, name: s.name || "Unnamed" }; });
        var textMergeDone = loadTextStylesUsedOnPage().then(function (usedOnPage) {
          var tid = {};
          for (var i = 0; i < localTextStyles.length; i++) tid[localTextStyles[i].id] = localTextStyles[i];
          for (var j = 0; j < usedOnPage.length; j++) {
            if (!tid[usedOnPage[j].id]) {
              tid[usedOnPage[j].id] = usedOnPage[j];
              localTextStyles.push(usedOnPage[j]);
            }
          }
          textStyles = localTextStyles;
        }).catch(function () { textStyles = localTextStyles; });
        Promise.all([paintMergeDone, textMergeDone]).then(loadVariables).catch(function () { loadVariables(); });
      }).catch(function () { loadVariables(); });
    })();
    return;
  }
  if (msg.type === "applyFillToGroup") {
    var nodeIds = msg.nodeIds;
    var styleId = msg.styleId;
    var variableId = msg.variableId;
    var variableKey = msg.variableKey;
    if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) return;
    if ((!styleId || typeof styleId !== "string") && (!variableId || typeof variableId !== "string") && (!variableKey || typeof variableKey !== "string")) return;
    function doApplyFillToGroup(applyVariableId) {
      var i = 0;
      function next() {
        if (i >= nodeIds.length) {
          figma.ui.postMessage({ type: "applyFillToGroupResult", applied: nodeIds.length });
          figma.notify("Applied to " + nodeIds.length + " layer(s)");
          return;
        }
        var nodeId = nodeIds[i];
        figma.getNodeByIdAsync(nodeId).then(function (node) {
          if (!node || node.removed) { i++; next(); return; }
          if (node.type === "TEXT") {
            var len = node.characters ? node.characters.length : 0;
            if (len > 0) {
              var promise;
              if (styleId) {
                promise = (typeof node.setRangeFillStyleIdAsync === "function")
                  ? node.setRangeFillStyleIdAsync(0, len, styleId)
                  : (node.setRangeFillStyleId ? Promise.resolve(node.setRangeFillStyleId(0, len, styleId)) : Promise.resolve());
              } else if (applyVariableId) {
                var alias = { type: "VARIABLE_ALIAS", id: applyVariableId };
                var paint = { type: "SOLID", color: { r: 0, g: 0, b: 0 }, boundVariables: { color: alias } };
                if (node.setRangeFills) {
                  try { node.setRangeFills(0, len, [paint]); } catch (_) {}
                }
                promise = Promise.resolve();
              } else {
                promise = Promise.resolve();
              }
              promise.then(function () { i++; next(); }).catch(function () { i++; next(); });
              return;
            }
          } else if (hasFills(node)) {
            try {
              if (styleId) {
                if (typeof node.fillStyleId !== "undefined") {
                  if (typeof node.setFillStyleIdAsync === "function") {
                    node.setFillStyleIdAsync(styleId).then(function () { i++; next(); }).catch(function () { i++; next(); });
                    return;
                  }
                  node.fillStyleId = styleId;
                }
              } else if (applyVariableId) {
                var alias = { type: "VARIABLE_ALIAS", id: applyVariableId };
                var paint = { type: "SOLID", color: { r: 0, g: 0, b: 0 }, boundVariables: { color: alias } };
                var arr = Array.isArray(node.fills) ? node.fills.slice() : [];
                arr[0] = paint;
                node.fills = arr;
              }
            } catch (_) {}
          }
          i++;
          next();
        }).catch(function () { i++; next(); });
      }
      next();
    }
    if (variableKey && typeof variableKey === "string") {
      if (figma.variables && typeof figma.variables.importVariableByKeyAsync === "function") {
        figma.variables.importVariableByKeyAsync(variableKey).then(function (variable) {
          if (variable && variable.id) doApplyFillToGroup(variable.id);
          else figma.ui.postMessage({ type: "applyFillToGroupResult", applied: 0 });
        }).catch(function () { figma.ui.postMessage({ type: "applyFillToGroupResult", applied: 0 }); });
      } else {
        figma.ui.postMessage({ type: "applyFillToGroupResult", applied: 0 });
      }
    } else {
      doApplyFillToGroup(variableId);
    }
    return;
  }
  if (msg.type === "applyTextStyleToGroup") {
    var nodeIds = msg.nodeIds;
    var textStyleId = msg.textStyleId;
    if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) return;
    if (!textStyleId || typeof textStyleId !== "string") return;
    (function () {
      var i = 0;
      function next() {
        if (i >= nodeIds.length) {
          figma.ui.postMessage({ type: "applyTextStyleToGroupResult", applied: nodeIds.length });
          figma.notify("Text style applied to " + nodeIds.length + " layer(s)");
          return;
        }
        var nodeId = nodeIds[i];
        figma.getNodeByIdAsync(nodeId).then(function (node) {
          if (node && !node.removed && node.type === "TEXT") {
            var len = node.characters ? node.characters.length : 0;
            if (len > 0) {
              var promise = (typeof node.setRangeTextStyleIdAsync === "function")
                ? node.setRangeTextStyleIdAsync(0, len, textStyleId)
                : (node.setRangeTextStyleId ? Promise.resolve(node.setRangeTextStyleId(0, len, textStyleId)) : Promise.resolve());
              promise.then(function () { i++; next(); }).catch(function () { i++; next(); });
              return;
            }
          }
          i++;
          next();
        }).catch(function () { i++; next(); });
      }
      next();
    })();
    return;
  }
  if (msg.type === "getSelectionFramesCount") {
    postSelectionFramesCount();
    return;
  }
  if (msg.type === "getRewriterSettings") {
    Promise.all([
      figma.clientStorage.getAsync("rewriterPrefix"),
      figma.clientStorage.getAsync("rewriterLayerPanelOrder"),
    ])
      .then(function (arr) {
        var prefix = typeof arr[0] === "string" ? arr[0] : "";
        var layerPanelOrder = arr[1] === true;
        figma.ui.postMessage({ type: "rewriterSettings", prefix: prefix, layerPanelOrder: layerPanelOrder });
      })
      .catch(function () {
        figma.ui.postMessage({ type: "rewriterSettings", prefix: "", layerPanelOrder: false });
      });
    return;
  }
  if (msg.type === "saveRewriterLayerPanelOrder") {
    figma.clientStorage.setAsync("rewriterLayerPanelOrder", msg.value === true).catch(function () {});
    return;
  }
  if (msg.type === "saveRewriterPrefix") {
    var raw = msg.prefix;
    if (typeof raw !== "string") raw = "";
    var stored = raw.replace(/[^a-zA-Z]/g, "").slice(0, 20);
    figma.clientStorage.setAsync("rewriterPrefix", stored).catch(function () {});
    return;
  }
  if (msg.type === "renameFrames") {
    var prefix = msg.prefix;
    if (typeof prefix !== "string") prefix = "";
    prefix = prefix.trim();
    var lettersOnly = /^[a-zA-Z]+$/;
    if (!lettersOnly.test(prefix)) {
      figma.ui.postMessage({ type: "renameFramesResult", error: "Prefix must contain only letters (a–z, A–Z)." });
      return;
    }
    var selection = figma.currentPage.selection;
    var frames = selection.filter(function (n) { return n && !n.removed && n.type === "FRAME"; });
    if (frames.length === 0) {
      figma.ui.postMessage({ type: "renameFramesResult", error: "No frames selected. Select one or more top-level frames." });
      return;
    }
    try {
      var useLayerPanelOrder = msg.layerPanelOrder === true;
      var ordered;
      if (useLayerPanelOrder) {
        ordered = sortFramesByLayerPanelOrder(frames, figma.currentPage);
      } else {
        ordered = frames.slice();
        ordered.sort(function (a, b) {
          var ba = a.absoluteBoundingBox;
          var bb = b.absoluteBoundingBox;
          var ax = ba && typeof ba.x === "number" ? ba.x : 0;
          var ay = ba && typeof ba.y === "number" ? ba.y : 0;
          var bx = bb && typeof bb.x === "number" ? bb.x : 0;
          var by = bb && typeof bb.y === "number" ? bb.y : 0;
          if (Math.abs(ay - by) > 0.5) return ay - by;
          return ax - bx;
        });
      }
      for (var i = 0; i < ordered.length; i++) {
        var num = i + 1;
        var numStr = num < 10 ? "0" + num : String(num);
        ordered[i].name = prefix + "-" + numStr;
      }
      figma.ui.postMessage({ type: "renameFramesResult", renamed: ordered.length });
      figma.notify("Renamed " + ordered.length + " frame(s)");
    } catch (err) {
      figma.ui.postMessage({ type: "renameFramesResult", error: (err && err.message) ? err.message : String(err) });
    }
    return;
  }
  if (msg.type === "deleteNodes") {
    var ids = msg.ids;
    if (!ids || !Array.isArray(ids)) return;
    var promises = ids.map(function (id) { return figma.getNodeByIdAsync(id); });
    Promise.all(promises).then(function (nodes) {
      var deleted = 0;
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (node && !node.removed) {
          node.remove();
          deleted++;
        }
      }
      figma.ui.postMessage({ type: "cleanerDeleted", deleted: deleted });
      if (deleted > 0) figma.notify("Deleted " + deleted + " element(s)");
    });
    return;
  }
};

// Автозагрузка стилей при открытии плагина
loadDocumentStyles().then(function (data) {
  figma.ui.postMessage({ type: "documentStyles", textStyles: data.textStyles, paintStyles: data.paintStyles });
});
