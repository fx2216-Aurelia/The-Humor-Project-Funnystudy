import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync("src/components/CaptionVoteFlow.tsx", "utf8");
const file = ts.createSourceFile("CaptionVoteFlow.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const options = file.statements.find((statement) =>
  ts.isVariableStatement(statement) && statement.declarationList.declarations.some(
    (declaration) => declaration.name.getText(file) === "STUDY_RATING_OPTIONS"
  )
);
const scale = file.statements.find((statement) =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === "RatingScale"
);
const countdown = file.statements.find((statement) =>
  ts.isFunctionDeclaration(statement) && statement.name?.text === "ViewCountdown"
);
assert.ok(options && scale && countdown);
const js = ts.transpile(`${options.getText(file)}\n${scale.getText(file)}\n${countdown.getText(file)}\nexport { RatingScale, ViewCountdown };`, {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
});

test("study page order is progress bar, image, caption, rating buttons", () => {
  const body = source.slice(source.indexOf("<StudyProgressIndicator\n"), source.indexOf("{isWheelNavigationOverlayVisible ?"));
  const order = ["<StudyProgressIndicator", "<SwipeVoteCard", "<CaptionPrompt", "<RatingScale"].map((tag) => body.indexOf(tag));
  assert.ok(order.every((index) => index >= 0), "all four sections render");
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.equal((body.match(/<CaptionPrompt/g) ?? []).length, 1);
  const between = body.slice(body.indexOf("<CaptionPrompt"), body.indexOf("<RatingScale"));
  assert.doesNotMatch(between.replace("<CaptionPrompt content={current.content} />", ""), /<button|<div/);
});

test("countdown uses the rating gate state for loading, each second, and ready", () => {
  const display = (imageReady, secondsRemaining) =>
    renderToStaticMarkup(createElement(loaded.exports.ViewCountdown, { imageReady, secondsRemaining, pending: false }));
  assert.match(display(false, 5), /Waiting for image/);
  for (let seconds = 5; seconds >= 1; seconds--) {
    const markup = display(true, seconds);
    assert.match(markup, new RegExp(`${seconds} seconds remaining`));
    assert.match(markup, new RegExp(`>${seconds}</span>`));
    assert.equal((render({ imageReady: true, secondsRemaining: seconds }).match(/disabled=""/g) ?? []).length, 4);
  }
  assert.match(display(true, 0), /Ready to rate/);
  assert.match(renderToStaticMarkup(createElement(loaded.exports.ViewCountdown, { imageReady: true, secondsRemaining: 0, pending: true })), /Saving rating/);
  assert.equal((render({ imageReady: true, secondsRemaining: 0 }).match(/disabled=""/g) ?? []).length, 0);
  const indicator = source.slice(source.indexOf("function StudyProgressIndicator("), source.indexOf("function LionMascot("));
  assert.ok(indicator.indexOf("<ViewCountdown ") < indicator.indexOf("<LionMascot />"));
  assert.match(source, /<StudyProgressIndicator[\s\S]*?imageReady=\{isImageReady\}[\s\S]*?secondsRemaining=\{viewSecondsRemaining\}/);
});
const loaded = { exports: {} };
new Function("require", "module", "exports", js)(require, loaded, loaded.exports);

function render(props) {
  return renderToStaticMarkup(createElement(loaded.exports.RatingScale, {
    selectedValue: "funny", pending: false, secondsRemaining: 0,
    imageReady: true, onSelect: () => {}, ...props,
  }));
}

test("ratings stay disabled while the image loads and throughout the countdown", () => {
  const loading = render({ imageReady: false });
  assert.match(loading, /Waiting for the image to load/);
  assert.equal((loading.match(/disabled=""/g) ?? []).length, 4);
  for (const seconds of [5, 1]) {
    const markup = render({ secondsRemaining: seconds });
    assert.match(markup, new RegExp(`view this image for ${seconds} more second`));
    assert.equal((markup.match(/disabled=""/g) ?? []).length, 4);
  }
});

test("ratings become available after the countdown and block during save", () => {
  const available = render({});
  assert.match(available, /Choose a rating to continue/);
  assert.equal((available.match(/disabled=""/g) ?? []).length, 0);
  assert.equal((available.match(/aria-pressed="true"/g) ?? []).length, 1);
  const saving = render({ pending: true });
  assert.match(saving, /Saving your rating/);
  assert.equal((saving.match(/disabled=""/g) ?? []).length, 4);
});
