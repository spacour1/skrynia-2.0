#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_CONFIG_PATH = "config/financial-freeze.json";
const GIT_MAX_BUFFER = 64 * 1024 * 1024;

export class FinancialFreezeSafeFailure extends Error {
  constructor(message) {
    super(message);
    this.name = "FinancialFreezeSafeFailure";
  }
}

class ProtectedRangeError extends Error {
  constructor(ruleId, message) {
    super(message);
    this.name = "ProtectedRangeError";
    this.ruleId = ruleId;
  }
}

function safeFailure(message) {
  throw new FinancialFreezeSafeFailure(message);
}

export function normalizeRepoPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    safeFailure("repository paths must be non-empty strings");
  }

  const normalized = value.replace(/\\/gu, "/").replace(/^\.\//u, "");
  const segments = normalized.split("/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized) ||
    isAbsolute(normalized) ||
    segments.some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    safeFailure(`invalid repository-relative path: ${value}`);
  }
  return normalized;
}

function normalizedPrefix(value) {
  const withoutTrailingSlash = value.replace(/[\\/]+$/u, "");
  return `${normalizeRepoPath(withoutTrailingSlash)}/`;
}

function requireArray(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    safeFailure(`${label} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  return value;
}

function requireId(value, label) {
  if (typeof value !== "string" || !/^[a-z0-9][a-z0-9._-]*$/u.test(value)) {
    safeFailure(`${label} must be a stable lowercase identifier`);
  }
  return value;
}

function requireRegex(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    safeFailure(`${label} must be a non-empty regular expression`);
  }
  try {
    new RegExp(value, "u");
  } catch {
    safeFailure(`${label} is not a valid regular expression`);
  }
  return value;
}

function normalizeExtensions(value, label) {
  if (value === undefined) return [];
  return requireArray(value, label).map((extension) => {
    if (typeof extension !== "string" || !/^\.[A-Za-z0-9]+$/u.test(extension)) {
      safeFailure(`${label} entries must be extensions such as .ts`);
    }
    return extension.toLowerCase();
  });
}

export function validateConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    safeFailure("financial freeze config must be an object");
  }
  if (input.schemaVersion !== 1) {
    safeFailure("unsupported financial freeze config schemaVersion");
  }

  const seenIds = new Set();
  const takeId = (value, label) => {
    const id = requireId(value, label);
    if (seenIds.has(id)) safeFailure(`duplicate financial freeze rule id: ${id}`);
    seenIds.add(id);
    return id;
  };

  const pathRules = requireArray(input.pathRules, "pathRules").map((rule, index) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      safeFailure(`pathRules[${index}] must be an object`);
    }
    const id = takeId(rule.id, `pathRules[${index}].id`);
    if (!new Set(["files", "prefix", "base-prefix", "path-regex"]).has(rule.type)) {
      safeFailure(`path rule ${id} has an unsupported type`);
    }
    const extensions = normalizeExtensions(rule.extensions, `path rule ${id}.extensions`);
    if (rule.type === "files") {
      const paths = requireArray(rule.paths, `path rule ${id}.paths`).map(normalizeRepoPath);
      return { id, type: rule.type, paths, extensions };
    }
    if (rule.type === "path-regex") {
      if (rule.caseSensitive !== undefined && typeof rule.caseSensitive !== "boolean") {
        safeFailure(`path rule ${id}.caseSensitive must be a boolean`);
      }
      const patterns = requireArray(rule.patterns, `path rule ${id}.patterns`).map((pattern, patternIndex) =>
        requireRegex(pattern, `path rule ${id}.patterns[${patternIndex}]`)
      );
      return { id, type: rule.type, patterns, extensions, caseSensitive: rule.caseSensitive === true };
    }
    const prefixes = requireArray(rule.prefixes, `path rule ${id}.prefixes`).map(normalizedPrefix);
    return { id, type: rule.type, prefixes, extensions };
  });

  const mixedPathSet = new Set();
  const mixedFiles = requireArray(input.mixedFiles, "mixedFiles", { allowEmpty: true }).map((rule, index) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      safeFailure(`mixedFiles[${index}] must be an object`);
    }
    const filePath = normalizeRepoPath(rule.path);
    if (mixedPathSet.has(filePath)) safeFailure(`duplicate mixed file rule: ${filePath}`);
    mixedPathSet.add(filePath);
    const symbols = requireArray(rule.symbols ?? [], `${filePath}.symbols`, { allowEmpty: true }).map(
      (symbol, symbolIndex) => {
        if (!symbol || typeof symbol !== "object" || Array.isArray(symbol)) {
          safeFailure(`${filePath}.symbols[${symbolIndex}] must be an object`);
        }
        const id = takeId(symbol.id, `${filePath}.symbols[${symbolIndex}].id`);
        const start = requireRegex(symbol.start, `${id}.start`);
        const end = symbol.end === null || symbol.end === undefined ? null : requireRegex(symbol.end, `${id}.end`);
        const toEnd = symbol.toEnd === true;
        if (toEnd && end !== null) safeFailure(`${id} cannot define both end and toEnd`);
        const expectedStarts = symbol.expectedStarts ?? 1;
        const startOccurrence = symbol.startOccurrence ?? 1;
        if (
          !Number.isInteger(expectedStarts) ||
          expectedStarts < 1 ||
          !Number.isInteger(startOccurrence) ||
          startOccurrence < 1 ||
          startOccurrence > expectedStarts
        ) {
          safeFailure(`${id} start anchor counts must be positive and internally consistent`);
        }
        const expectedEnds = end === null ? 0 : (symbol.expectedEnds ?? 1);
        const endOccurrence = end === null ? 0 : (symbol.endOccurrence ?? 1);
        if (
          end !== null &&
          (!Number.isInteger(expectedEnds) ||
            expectedEnds < 1 ||
            !Number.isInteger(endOccurrence) ||
            endOccurrence < 1 ||
            endOccurrence > expectedEnds)
        ) {
          safeFailure(`${id} end anchor counts must be positive and internally consistent`);
        }
        if (end === null && (symbol.expectedEnds !== undefined || symbol.endOccurrence !== undefined)) {
          safeFailure(`${id} cannot define end anchor counts without end`);
        }
        const includeBefore = symbol.includeBefore ?? 0;
        const includeAfter = symbol.includeAfter ?? 0;
        if (!Number.isInteger(includeBefore) || includeBefore < 0 || !Number.isInteger(includeAfter) || includeAfter < 0) {
          safeFailure(`${id} symbol window must use non-negative integers`);
        }
        return {
          id,
          start,
          end,
          toEnd,
          expectedStarts,
          startOccurrence,
          expectedEnds,
          endOccurrence,
          includeBefore,
          includeAfter,
          includeEnd: symbol.includeEnd === true
        };
      }
    );
    const anchors = requireArray(rule.anchors ?? [], `${filePath}.anchors`, { allowEmpty: true }).map(
      (anchor, anchorIndex) => {
        if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) {
          safeFailure(`${filePath}.anchors[${anchorIndex}] must be an object`);
        }
        const id = takeId(anchor.id, `${filePath}.anchors[${anchorIndex}].id`);
        const pattern = requireRegex(anchor.pattern, `${id}.pattern`);
        const expected = anchor.expected ?? 1;
        const before = anchor.before ?? 0;
        const after = anchor.after ?? 0;
        if (!Number.isInteger(expected) || expected < 1 || !Number.isInteger(before) || before < 0 || !Number.isInteger(after) || after < 0) {
          safeFailure(`${id} anchor counts must be positive/non-negative integers`);
        }
        return { id, pattern, expected, before, after };
      }
    );
    const fragments = requireArray(rule.fragments ?? [], `${filePath}.fragments`, { allowEmpty: true }).map(
      (fragment, fragmentIndex) => {
        if (!fragment || typeof fragment !== "object" || Array.isArray(fragment)) {
          safeFailure(`${filePath}.fragments[${fragmentIndex}] must be an object`);
        }
        const id = takeId(fragment.id, `${filePath}.fragments[${fragmentIndex}].id`);
        const pattern = requireRegex(fragment.pattern, `${id}.pattern`);
        if (new RegExp(pattern, "u").test("")) safeFailure(`${id}.pattern must not match empty content`);
        const expected = fragment.expected ?? 1;
        if (!Number.isInteger(expected) || expected < 0) {
          safeFailure(`${id} fragment count must be a non-negative integer`);
        }
        return { id, pattern, expected };
      }
    );
    if (symbols.length === 0 && anchors.length === 0 && fragments.length === 0) {
      safeFailure(`mixed file ${filePath} has no protected symbols, anchors, or fragments`);
    }
    return {
      path: filePath,
      protectRenameDelete: rule.protectRenameDelete !== false,
      symbols,
      anchors,
      fragments
    };
  });

  const newFileRules = requireArray(input.newFileRules, "newFileRules", { allowEmpty: true }).map((rule, index) => {
    if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
      safeFailure(`newFileRules[${index}] must be an object`);
    }
    const id = takeId(rule.id, `newFileRules[${index}].id`);
    const prefixes = requireArray(rule.prefixes, `${id}.prefixes`).map(normalizedPrefix);
    const extensions = normalizeExtensions(rule.extensions, `${id}.extensions`);
    const patterns = requireArray(rule.patterns, `${id}.patterns`).map((pattern, patternIndex) =>
      requireRegex(pattern, `${id}.patterns[${patternIndex}]`)
    );
    return { id, prefixes, extensions, patterns };
  });

  const changedContentRules = requireArray(input.changedContentRules ?? [], "changedContentRules", { allowEmpty: true }).map(
    (rule, index) => {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) {
        safeFailure(`changedContentRules[${index}] must be an object`);
      }
      const id = takeId(rule.id, `changedContentRules[${index}].id`);
      const prefixes = requireArray(rule.prefixes, `${id}.prefixes`).map(normalizedPrefix);
      const excludePaths = requireArray(rule.excludePaths ?? [], `${id}.excludePaths`, { allowEmpty: true }).map(
        normalizeRepoPath
      );
      const extensions = normalizeExtensions(rule.extensions, `${id}.extensions`);
      const patterns = requireArray(rule.patterns, `${id}.patterns`).map((pattern, patternIndex) =>
        requireRegex(pattern, `${id}.patterns[${patternIndex}]`)
      );
      const contextPatterns = requireArray(rule.contextPatterns ?? [], `${id}.contextPatterns`, { allowEmpty: true }).map(
        (context, contextIndex) => {
          if (!context || typeof context !== "object" || Array.isArray(context)) {
            safeFailure(`${id}.contextPatterns[${contextIndex}] must be an object`);
          }
          const pattern = requireRegex(context.pattern, `${id}.contextPatterns[${contextIndex}].pattern`);
          const signals = requireArray(context.signals, `${id}.contextPatterns[${contextIndex}].signals`).map(
            (signal, signalIndex) => requireRegex(signal, `${id}.contextPatterns[${contextIndex}].signals[${signalIndex}]`)
          );
          return { pattern, signals };
        }
      );
      return { id, prefixes, excludePaths, extensions, patterns, contextPatterns };
    }
  );

  return { schemaVersion: 1, pathRules, mixedFiles, newFileRules, changedContentRules };
}

function runGitResult(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
    maxBuffer: GIT_MAX_BUFFER
  });
  if (result.error) safeFailure(`git could not run: ${args[0] ?? "command"}`);
  return result;
}

function runGit(repoRoot, args) {
  const result = runGitResult(repoRoot, args);
  if (result.status !== 0) safeFailure(`git command failed safely: ${args[0] ?? "command"}`);
  return result.stdout;
}

function resolveRepositoryRoot(repoRoot) {
  const candidate = resolve(repoRoot);
  const output = runGit(candidate, ["rev-parse", "--show-toplevel"]).trim();
  try {
    return realpathSync(output);
  } catch {
    safeFailure("git repository root cannot be resolved");
  }
}

function resolveInsideRepo(repoRoot, repoPath) {
  const target = resolve(repoRoot, ...normalizeRepoPath(repoPath).split("/"));
  const relativePath = relative(repoRoot, target);
  if (relativePath === "" || relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    safeFailure(`path escapes repository root: ${repoPath}`);
  }
  return target;
}

function loadConfig(repoRoot, configPath) {
  const normalizedConfigPath = normalizeRepoPath(configPath);
  const absoluteConfigPath = resolveInsideRepo(repoRoot, normalizedConfigPath);
  if (!existsSync(absoluteConfigPath)) safeFailure(`financial freeze config is missing: ${normalizedConfigPath}`);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(absoluteConfigPath, "utf8"));
  } catch {
    safeFailure(`financial freeze config is not valid JSON: ${normalizedConfigPath}`);
  }
  return validateConfig(parsed);
}

function resolveBase(repoRoot, baseRef) {
  if (typeof baseRef !== "string" || baseRef.trim() === "" || /^0+$/u.test(baseRef.trim())) {
    safeFailure("--base must name a real ancestor commit");
  }
  const result = runGitResult(repoRoot, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`]);
  if (result.status !== 0) safeFailure("base ref does not resolve to a commit");
  const baseSha = result.stdout.trim();
  if (!/^[0-9a-f]{40,64}$/u.test(baseSha)) safeFailure("base ref resolved to an invalid commit id");

  const ancestor = runGitResult(repoRoot, ["merge-base", "--is-ancestor", baseSha, "HEAD"]);
  if (ancestor.status === 1) safeFailure("base commit is not an ancestor of HEAD");
  if (ancestor.status !== 0) safeFailure("base ancestry could not be verified");
  return baseSha;
}

export function parseNameStatusZ(output) {
  if (typeof output !== "string") safeFailure("name-status output must be text");
  const tokens = output.split("\0");
  if (tokens.at(-1) === "") tokens.pop();
  const changes = [];
  let index = 0;
  while (index < tokens.length) {
    let statusToken = tokens[index++];
    let firstPath = null;
    const tabIndex = statusToken.indexOf("\t");
    if (tabIndex >= 0) {
      firstPath = statusToken.slice(tabIndex + 1);
      statusToken = statusToken.slice(0, tabIndex);
    }
    if (!/^[ACDMRTUXB][0-9]*$/u.test(statusToken)) safeFailure("unrecognized git name-status record");
    const status = statusToken[0];
    const oldPath = normalizeRepoPath(firstPath ?? tokens[index++]);
    if (status === "R" || status === "C") {
      if (index >= tokens.length) safeFailure("truncated git rename/copy record");
      changes.push({ status, statusToken, oldPath, newPath: normalizeRepoPath(tokens[index++]) });
    } else {
      changes.push({ status, statusToken, oldPath, newPath: status === "D" ? null : oldPath });
    }
  }
  return changes;
}

export function parseZeroContextHunks(patch) {
  if (typeof patch !== "string") safeFailure("patch output must be text");
  const hunks = [];
  const pattern = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gmu;
  let match;
  while ((match = pattern.exec(patch)) !== null) {
    hunks.push({
      oldStart: Number(match[1]),
      oldCount: match[2] === undefined ? 1 : Number(match[2]),
      newStart: Number(match[3]),
      newCount: match[4] === undefined ? 1 : Number(match[4])
    });
  }
  return hunks;
}

function matchingLineIndexes(lines, pattern) {
  const regex = new RegExp(pattern, "u");
  const indexes = [];
  for (let index = 0; index < lines.length; index += 1) {
    regex.lastIndex = 0;
    if (regex.test(lines[index])) indexes.push(index);
  }
  return indexes;
}

export function locateProtectedRanges(source, mixedRule) {
  const lines = source.split(/\r?\n/u);
  const ranges = [];
  for (const symbol of mixedRule.symbols) {
    const starts = matchingLineIndexes(lines, symbol.start);
    if (starts.length !== symbol.expectedStarts) {
      throw new ProtectedRangeError(symbol.id, `expected ${symbol.expectedStarts} start anchors, found ${starts.length}`);
    }
    const startIndex = starts[symbol.startOccurrence - 1];
    let endLine = symbol.toEnd ? lines.length : startIndex + 1;
    if (symbol.end !== null) {
      const endRegex = new RegExp(symbol.end, "u");
      const endIndexes = [];
      for (let index = startIndex + 1; index < lines.length; index += 1) {
        endRegex.lastIndex = 0;
        if (endRegex.test(lines[index])) endIndexes.push(index);
      }
      if (endIndexes.length !== symbol.expectedEnds) {
        throw new ProtectedRangeError(
          symbol.id,
          `expected ${symbol.expectedEnds} end anchors after the start, found ${endIndexes.length}`
        );
      }
      const endIndex = endIndexes[symbol.endOccurrence - 1];
      endLine = symbol.includeEnd ? endIndex + 1 : endIndex;
    }
    const startLine = Math.max(1, startIndex + 1 - symbol.includeBefore);
    endLine = Math.min(lines.length, endLine + symbol.includeAfter);
    if (endLine < startLine) throw new ProtectedRangeError(symbol.id, "protected range is empty");
    ranges.push({ id: symbol.id, start: startLine, end: endLine });
  }

  for (const anchor of mixedRule.anchors) {
    const matches = matchingLineIndexes(lines, anchor.pattern);
    if (matches.length !== anchor.expected) {
      throw new ProtectedRangeError(anchor.id, `expected ${anchor.expected} anchors, found ${matches.length}`);
    }
    for (const matchIndex of matches) {
      ranges.push({
        id: anchor.id,
        start: Math.max(1, matchIndex + 1 - anchor.before),
        end: Math.min(lines.length, matchIndex + 1 + anchor.after)
      });
    }
  }
  return ranges;
}

export function locateProtectedFragments(source, mixedRule) {
  return mixedRule.fragments.map((fragment) => {
    const matches = [...source.matchAll(new RegExp(fragment.pattern, "gu"))].map((match) => match[0]);
    if (matches.some((match) => match.length === 0)) {
      throw new ProtectedRangeError(fragment.id, "fragment pattern matched empty content");
    }
    if (matches.length !== fragment.expected) {
      throw new ProtectedRangeError(fragment.id, `expected ${fragment.expected} fragments, found ${matches.length}`);
    }
    return { id: fragment.id, matches };
  });
}

export function rangesOverlap(start, count, range) {
  if (count <= 0) return false;
  const end = start + count - 1;
  return start <= range.end && end >= range.start;
}

function extensionMatches(repoPath, extensions) {
  return extensions.length === 0 || extensions.includes(extname(repoPath).toLowerCase());
}

function pathRuleMatches(rule, repoPath, basePaths) {
  if (!extensionMatches(repoPath, rule.extensions)) return false;
  if (rule.type === "files") return rule.paths.includes(repoPath);
  if (rule.type === "path-regex") {
    const flags = rule.caseSensitive ? "u" : "iu";
    return rule.patterns.some((pattern) => new RegExp(pattern, flags).test(repoPath));
  }
  if (!rule.prefixes.some((prefix) => repoPath.startsWith(prefix))) return false;
  return rule.type === "prefix" || basePaths.has(repoPath);
}

function newFileRuleMatchesPath(rule, repoPath) {
  return extensionMatches(repoPath, rule.extensions) && rule.prefixes.some((prefix) => repoPath.startsWith(prefix));
}

function hasApplicableNewFileRule(config, repoPath) {
  return config.newFileRules.some((rule) => newFileRuleMatchesPath(rule, repoPath));
}

function changedContentRuleMatchesPath(rule, repoPath) {
  return (
    !rule.excludePaths.includes(repoPath) &&
    extensionMatches(repoPath, rule.extensions) &&
    rule.prefixes.some((prefix) => repoPath.startsWith(prefix))
  );
}

function readGitObject(repoRoot, objectSpec) {
  const result = runGitResult(repoRoot, ["show", "--no-textconv", objectSpec]);
  if (result.status !== 0) return null;
  return result.stdout;
}

function readWorkingTreeFile(repoRoot, repoPath) {
  const absolutePath = resolveInsideRepo(repoRoot, repoPath);
  if (!existsSync(absolutePath)) return null;
  try {
    return readFileSync(absolutePath, "utf8");
  } catch {
    safeFailure(`working-tree file could not be read: ${repoPath}`);
  }
}

function targetContent(repoRoot, comparison, repoPath) {
  if (comparison === "head") return readGitObject(repoRoot, `HEAD:${repoPath}`);
  if (comparison === "index") return readGitObject(repoRoot, `:${repoPath}`);
  return readWorkingTreeFile(repoRoot, repoPath);
}

function comparisonNameStatus(repoRoot, baseSha, comparison) {
  const common = ["diff", "--name-status", "-z", "-M50%"];
  if (comparison === "head") return runGit(repoRoot, [...common, baseSha, "HEAD", "--"]);
  if (comparison === "index") return runGit(repoRoot, [...common, "--cached", baseSha, "--"]);
  return runGit(repoRoot, [...common, baseSha, "--"]);
}

function comparisonPatch(repoRoot, baseSha, comparison, repoPath) {
  const common = ["diff", "--unified=0", "--no-color", "--no-ext-diff", "--no-textconv", "-M50%"];
  if (comparison === "head") return runGit(repoRoot, [...common, baseSha, "HEAD", "--", repoPath]);
  if (comparison === "index") return runGit(repoRoot, [...common, "--cached", baseSha, "--", repoPath]);
  return runGit(repoRoot, [...common, baseSha, "--", repoPath]);
}

function violation(comparison, change, ruleId, pathOverride) {
  return {
    comparison,
    status: change.statusToken,
    oldPath: change.oldPath,
    newPath: change.newPath,
    path: pathOverride ?? change.newPath ?? change.oldPath,
    ruleId
  };
}

function scanNewFileRules(content, repoPath, config, comparison, change, violations) {
  for (const rule of config.newFileRules) {
    if (!newFileRuleMatchesPath(rule, repoPath)) continue;
    if (rule.patterns.some((pattern) => new RegExp(pattern, "iu").test(content))) {
      violations.push(violation(comparison, change, rule.id, repoPath));
    }
  }
}

function changedHunkLinesMatch(content, hunks, side, patterns) {
  if (content === null) return false;
  const lines = content.split(/\r?\n/u);
  const startKey = side === "old" ? "oldStart" : "newStart";
  const countKey = side === "old" ? "oldCount" : "newCount";
  const regexes = patterns.map((pattern) => new RegExp(pattern, "iu"));
  for (const hunk of hunks) {
    const count = hunk[countKey];
    if (count <= 0) continue;
    const startIndex = Math.max(0, hunk[startKey] - 1);
    const changedSegment = lines.slice(startIndex, startIndex + count).join("\n");
    if (regexes.some((regex) => regex.test(changedSegment))) return true;
  }
  return false;
}

function fullContentMatches(content, patterns) {
  return content !== null && patterns.some((pattern) => new RegExp(pattern, "iu").test(content));
}

function changedContextMatches(content, hunks, side, contexts) {
  return contexts.some(
    (context) =>
      fullContentMatches(content, [context.pattern]) &&
      changedHunkLinesMatch(content, hunks, side, context.signals)
  );
}

function scanChangedContentRules(repoRoot, baseSha, comparison, change, config, violations) {
  const oldRules = config.changedContentRules.filter((rule) => changedContentRuleMatchesPath(rule, change.oldPath));
  const newRules = change.newPath
    ? config.changedContentRules.filter((rule) => changedContentRuleMatchesPath(rule, change.newPath))
    : [];
  if (oldRules.length === 0 && newRules.length === 0) return;

  const patchPath = change.newPath ?? change.oldPath;
  const oldContent = readGitObject(repoRoot, `${baseSha}:${change.oldPath}`);
  const newContent = change.newPath ? targetContent(repoRoot, comparison, change.newPath) : null;

  if (change.status !== "M") {
    for (const rule of oldRules) {
      if (
        fullContentMatches(oldContent, rule.patterns) ||
        rule.contextPatterns.some((context) => fullContentMatches(oldContent, [context.pattern]))
      ) {
        violations.push(violation(comparison, change, rule.id, change.oldPath));
      }
    }
    for (const rule of newRules) {
      if (
        fullContentMatches(newContent, rule.patterns) ||
        rule.contextPatterns.some((context) => fullContentMatches(newContent, [context.pattern]))
      ) {
        violations.push(violation(comparison, change, rule.id, change.newPath));
      }
    }
    return;
  }

  const hunks = parseZeroContextHunks(comparisonPatch(repoRoot, baseSha, comparison, patchPath));
  if (hunks.length === 0) {
    violations.push(violation(comparison, change, "changed-content-unparseable", patchPath));
    return;
  }

  for (const rule of oldRules) {
    if (
      changedHunkLinesMatch(oldContent, hunks, "old", rule.patterns) ||
      changedContextMatches(oldContent, hunks, "old", rule.contextPatterns)
    ) {
      violations.push(violation(comparison, change, rule.id, change.oldPath));
    }
  }
  for (const rule of newRules) {
    if (
      changedHunkLinesMatch(newContent, hunks, "new", rule.patterns) ||
      changedContextMatches(newContent, hunks, "new", rule.contextPatterns)
    ) {
      violations.push(violation(comparison, change, rule.id, change.newPath));
    }
  }
}

function dedupeViolations(violations) {
  const seen = new Set();
  return violations.filter((item) => {
    const key = [item.status, item.oldPath ?? "", item.newPath ?? "", item.ruleId].join("\0");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function checkFinancialFreeze({
  repoRoot = process.cwd(),
  baseRef,
  configPath = DEFAULT_CONFIG_PATH
}) {
  const root = resolveRepositoryRoot(repoRoot);
  const config = loadConfig(root, configPath);
  const baseSha = resolveBase(root, baseRef);
  const baseFiles = new Set(
    runGit(root, ["ls-tree", "-r", "--name-only", "-z", baseSha])
      .split("\0")
      .filter(Boolean)
      .map(normalizeRepoPath)
  );

  const mixedByPath = new Map(config.mixedFiles.map((rule) => [rule.path, rule]));
  const baseRangeCache = new Map();
  const baseFragmentCache = new Map();
  for (const mixedRule of config.mixedFiles) {
    if (!baseFiles.has(mixedRule.path)) safeFailure(`mixed file is absent from base: ${mixedRule.path}`);
    const content = readGitObject(root, `${baseSha}:${mixedRule.path}`);
    if (content === null) safeFailure(`mixed file cannot be read from base: ${mixedRule.path}`);
    try {
      baseRangeCache.set(mixedRule.path, locateProtectedRanges(content, mixedRule));
      baseFragmentCache.set(mixedRule.path, locateProtectedFragments(content, mixedRule));
    } catch (error) {
      if (error instanceof ProtectedRangeError) {
        safeFailure(`base anchor validation failed: ${mixedRule.path} [${error.ruleId}]`);
      }
      throw error;
    }
  }

  const violations = [];
  for (const comparison of ["head", "index", "worktree"]) {
    const changes = parseNameStatusZ(comparisonNameStatus(root, baseSha, comparison));
    for (const change of changes) {
      const paths = [change.oldPath, change.newPath].filter(Boolean);
      let fullyFrozen = false;
      for (const rule of config.pathRules) {
        const matchedPath = paths.find((repoPath) => pathRuleMatches(rule, repoPath, baseFiles));
        if (matchedPath) {
          violations.push(violation(comparison, change, rule.id, matchedPath));
          fullyFrozen = true;
        }
      }
      if (fullyFrozen) continue;

      const touchedMixedPaths = paths.filter((repoPath) => mixedByPath.has(repoPath));
      if (touchedMixedPaths.length > 0) {
        const mixedPath = touchedMixedPaths[0];
        const mixedRule = mixedByPath.get(mixedPath);
        const lifecycleChange =
          change.status !== "M" || change.oldPath !== change.newPath || touchedMixedPaths.some((repoPath) => repoPath !== mixedRule.path);
        if (lifecycleChange && mixedRule.protectRenameDelete) {
          violations.push(violation(comparison, change, `mixed-file-lifecycle:${mixedRule.path}`, mixedPath));
          continue;
        }

        const currentContent = targetContent(root, comparison, mixedRule.path);
        if (currentContent === null) {
          violations.push(violation(comparison, change, `mixed-file-unreadable:${mixedRule.path}`, mixedRule.path));
          continue;
        }
        let currentRanges;
        let currentFragments;
        try {
          currentRanges = locateProtectedRanges(currentContent, mixedRule);
          currentFragments = locateProtectedFragments(currentContent, mixedRule);
        } catch (error) {
          if (error instanceof ProtectedRangeError) {
            violations.push(violation(comparison, change, error.ruleId, mixedRule.path));
            continue;
          }
          throw error;
        }
        const currentFragmentsById = new Map(currentFragments.map((fragment) => [fragment.id, fragment.matches]));
        for (const baseFragment of baseFragmentCache.get(mixedRule.path)) {
          const currentMatches = currentFragmentsById.get(baseFragment.id);
          if (
            currentMatches.length !== baseFragment.matches.length ||
            currentMatches.some((match, index) => match !== baseFragment.matches[index])
          ) {
            violations.push(violation(comparison, change, baseFragment.id, mixedRule.path));
          }
        }
        const hunks = parseZeroContextHunks(comparisonPatch(root, baseSha, comparison, mixedRule.path));
        if (hunks.length === 0) {
          violations.push(violation(comparison, change, `mixed-file-unparseable:${mixedRule.path}`, mixedRule.path));
          continue;
        }
        const baseRanges = baseRangeCache.get(mixedRule.path);
        for (const protectedRange of baseRanges) {
          const overlaps = hunks.some((hunk) => rangesOverlap(hunk.oldStart, hunk.oldCount, protectedRange));
          if (overlaps) violations.push(violation(comparison, change, protectedRange.id, mixedRule.path));
        }
        for (const protectedRange of currentRanges) {
          const overlaps = hunks.some((hunk) => rangesOverlap(hunk.newStart, hunk.newCount, protectedRange));
          if (overlaps) violations.push(violation(comparison, change, protectedRange.id, mixedRule.path));
        }
      }

      scanChangedContentRules(root, baseSha, comparison, change, config, violations);

      if (
        (change.status === "A" || change.status === "C" || change.status === "R") &&
        change.newPath &&
        !baseFiles.has(change.newPath) &&
        hasApplicableNewFileRule(config, change.newPath)
      ) {
        const content = targetContent(root, comparison, change.newPath);
        if (content === null) safeFailure(`new file could not be inspected: ${change.newPath}`);
        scanNewFileRules(content, change.newPath, config, comparison, change, violations);
      }
    }
  }

  const untracked = runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .map(normalizeRepoPath);
  for (const repoPath of untracked) {
    const change = { status: "?", statusToken: "??", oldPath: repoPath, newPath: repoPath };
    let fullyFrozen = false;
    for (const rule of config.pathRules) {
      if (pathRuleMatches(rule, repoPath, baseFiles)) {
        violations.push(violation("untracked", change, rule.id, repoPath));
        fullyFrozen = true;
      }
    }
    if (mixedByPath.has(repoPath)) {
      violations.push(violation("untracked", change, `mixed-file-lifecycle:${repoPath}`, repoPath));
      fullyFrozen = true;
    }
    if (!fullyFrozen && hasApplicableNewFileRule(config, repoPath)) {
      const content = readWorkingTreeFile(root, repoPath);
      if (content === null) safeFailure(`untracked file could not be inspected: ${repoPath}`);
      scanNewFileRules(content, repoPath, config, "untracked", change, violations);
    }
    if (!fullyFrozen) {
      const content = readWorkingTreeFile(root, repoPath);
      if (content === null) safeFailure(`untracked file could not be inspected: ${repoPath}`);
      for (const rule of config.changedContentRules) {
        if (!changedContentRuleMatchesPath(rule, repoPath)) continue;
        if (
          fullContentMatches(content, rule.patterns) ||
          rule.contextPatterns.some((context) => fullContentMatches(content, [context.pattern]))
        ) {
          violations.push(violation("untracked", change, rule.id, repoPath));
        }
      }
    }
  }

  return { baseSha, violations: dedupeViolations(violations) };
}

function parseCliArguments(argv) {
  let baseRef = null;
  let configPath = DEFAULT_CONFIG_PATH;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--base" && index + 1 < argv.length) {
      baseRef = argv[++index];
    } else if (argument === "--config" && index + 1 < argv.length) {
      configPath = argv[++index];
    } else {
      safeFailure(`unsupported or incomplete argument: ${argument}`);
    }
  }
  if (baseRef === null) safeFailure("required argument is missing: --base <ref>");
  return { baseRef, configPath };
}

function formatViolation(item) {
  const pathLabel = item.oldPath !== item.newPath && item.newPath ? `${item.oldPath} -> ${item.newPath}` : item.path;
  return `- [${item.ruleId}] ${JSON.stringify(pathLabel)} (${item.status})`;
}

function runCli() {
  try {
    const options = parseCliArguments(process.argv.slice(2));
    const result = checkFinancialFreeze({ repoRoot: process.cwd(), ...options });
    if (result.violations.length > 0) {
      console.error("Financial freeze guard: FAIL");
      for (const item of result.violations) console.error(formatViolation(item));
      process.exitCode = 1;
      return;
    }
    console.log(`Financial freeze guard: PASS (base ${result.baseSha.slice(0, 12)})`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown failure";
    console.error(`Financial freeze guard: SAFE FAIL (${JSON.stringify(message)})`);
    process.exitCode = 2;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) runCli();
