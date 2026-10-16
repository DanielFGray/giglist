/**
 * PROTOTYPE check: marks stay on the content they were put on, in a real
 * browser. Pass: every placed mark is drawn at its own item after transpose,
 * resize, recorded edits and paste-overs, or sits in the tray when its content
 * is gone or its place is unproven. A mark drawn at any other item fails.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const fixture = readFileSync(path.join(import.meta.dirname, "../fixtures/amazing-grace.txt"), "utf8");
const [verse1, chorus, verse2] = fixture.split("\n\n[Chorus]\n").flatMap((part, i) => (i === 0 ? [part] : part.split("\n\n")));
const chorusBlock = `[Chorus]\n${chorus}`;
const NEW_VERSE = "[Verse 0]\nD              G\nA brand new verse up top\n";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("a text mark stays on its lyric through transpose and resize", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const target = item(page, "sweet the");
  const mark = await placeText(page, target, "softer");
  await expectOn(mark, target);

  await page.selectOption("#key-select", "A");
  await expect(lineChords(target)).resolves.toEqual(["A", "D", "A"]);
  await expectOn(mark, target);

  await page.setViewportSize({ width: 1024, height: 900 });
  await expectOn(mark, target);
});

test("a mark follows a recorded edit and a paste-over that insert a verse above it", async ({ page }) => {
  const target = item(page, "sweet the");
  const mark = await placeText(page, target, "softer");

  await editSource(page, NEW_VERSE + "\n" + fixture, "#save-edit");
  await expect(item(page, "brand new")).toBeVisible();
  await expectOn(mark, target, "kept");

  await editSource(page, NEW_VERSE + "\n" + NEW_VERSE.replace("Verse 0", "Verse 00") + "\n" + fixture, "#paste-over");
  await expectOnOrTray(page, mark, target);
});

test("a mark goes to the tray when its line is deleted, by either path", async ({ page }) => {
  for (const button of ["#save-edit", "#paste-over"]) {
    await editSource(page, fixture, "#import");
    const mark = await placeText(page, item(page, "sweet the"), "softer");
    await editSource(page, fixture.replace(/G +C +G\nAmazing grace, how sweet the sound\n/, ""), button);
    await expect(mark).toHaveCount(0);
    await expect(page.locator("#tray li")).toHaveCount(1);
  }
});

test("a mark on the second chorus never jumps to the first", async ({ page }) => {
  const secondChorus = item(page, "Unendin").nth(1);
  const mark = await placeText(page, secondChorus, "build");

  // Delete the first chorus: the mark keeps the remaining (second) chorus.
  const withoutFirst = [verse1, verse2, chorusBlock].join("\n\n");
  await editSource(page, withoutFirst, "#paste-over");
  await expectOnOrTray(page, mark, item(page, "Unendin").first());

  // Delete the chorus the mark is on: tray, not the other chorus.
  await editSource(page, fixture, "#import");
  const again = await placeText(page, item(page, "Unendin").nth(1), "build");
  await editSource(page, [verse1, chorusBlock, verse2].join("\n\n"), "#paste-over");
  await expect(again).toHaveCount(0);
  await expect(page.locator("#tray li")).toHaveCount(1);
});

test("two identical choruses back to back: a paste-over that removes one leaves the mark uncertain", async ({ page }) => {
  const doubled = [verse1, chorusBlock, chorusBlock, verse2].join("\n\n");
  await editSource(page, doubled, "#import");
  const second = item(page, "Unendin").nth(1);
  const mark = await placeText(page, second, "build");

  await editSource(page, [verse1, chorusBlock, verse2].join("\n\n"), "#paste-over");
  await expect(page.locator("#tray li")).toContainText("uncertain");
  await expect(mark).toHaveCount(0);
});

test("ink is saved as a stamp, pasted twice, moved, resized, and survives transpose", async ({ page }) => {
  const first = item(page, /^Amazing/);
  const box = (await first.boundingBox())!;
  await page.check('input[value="ink"]');
  await drag(page, [box.x + 10, box.y - 4], [box.x + 40, box.y + 6], [box.x + 70, box.y - 4]);
  await page.check('input[value="move"]');
  const ink = page.locator(".mark.ink").first();
  await expect(ink).toHaveAttribute("data-target", (await target(first))!);
  await ink.click();
  await page.click("#save-stamp");
  await expect(page.locator("#stamp-select option")).toHaveText(["half-time feel"]);

  await page.check('input[value="stamp"]');
  const chorusLine = item(page, /^chains/).first();
  const verse2Line = item(page, "'Twas");
  for (const target of [chorusLine, verse2Line]) {
    await target.scrollIntoViewIfNeeded();
    const b = (await target.boundingBox())!;
    await page.mouse.click(b.x + 4, b.y + 2);
  }
  await expect(page.locator(".mark.ink")).toHaveCount(3);
  await expect(page.locator(".mark.ink").nth(1)).toHaveAttribute("data-target", (await target(chorusLine))!);
  await expect(page.locator(".mark.ink").nth(2)).toHaveAttribute("data-target", (await target(verse2Line))!);

  // Move the third into the margin, then resize it.
  await page.check('input[value="move"]');
  const third = page.locator(".mark.ink").nth(2);
  await third.scrollIntoViewIfNeeded();
  const t = (await third.boundingBox())!;
  const gutter = (await page.locator("#gutter").boundingBox())!;
  await drag(page, [t.x + 5, t.y + 5], [gutter.x + 20, t.y + 5]);
  await third.click();
  const before = (await third.boundingBox())!;
  const handle = (await third.locator(".resize").boundingBox())!;
  await drag(page, [handle.x + 4, handle.y + 4], [handle.x + 40, handle.y + 20]);
  const after = (await third.boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width * 1.3);
  expect(after.x).toBeGreaterThanOrEqual(gutter.x);

  await page.selectOption("#key-select", "Bb");
  await page.setViewportSize({ width: 700, height: 900 });
  // The resize redraws every mark; retry until the redraw settles.
  await expect(async () => {
    await third.scrollIntoViewIfNeeded();
    const moved = (await third.boundingBox())!;
    const gutterNow = (await page.locator("#gutter").boundingBox())!;
    expect(moved.x).toBeGreaterThanOrEqual(gutterNow.x);
  }).toPass();
  await expect(page.locator(".mark.ink").nth(1)).toHaveAttribute("data-target", (await target(chorusLine))!);
});

const GP_FILE = path.join(homedir(), "Guitar Pro Tabs", "Amon Amarth - The Fate of Norns.gp5");

test("a mark on a tab beat stays on that beat when a new version of the file is loaded", async ({ page }) => {
  test.skip(!existsSync(GP_FILE), "needs the owner's Guitar Pro folder");
  // alphaTab unloads score sections that scroll off screen: pick the tool first.
  await page.check('input[value="text"]');
  await page.fill("#text-input", "accent");
  await page.setInputFiles("#gp-file", GP_FILE);
  await page.locator("#score-frame").scrollIntoViewIfNeeded();
  await expect(page.locator("#score-frame")).toHaveAttribute("data-rendered-version", "1", { timeout: 15_000 });
  // Click inside the first rendered system; alphaTab reports the beat under the pointer.
  const surface = page.locator("#score .at-surface-svg").first();
  await expect.poll(() => surface.boundingBox()).not.toBeNull();
  const system = (await surface.boundingBox())!;
  const mark = page.locator("#score-marks .mark");
  // alphaTab may start a second render after the scroll changes the page
  // width; a click during it hits no beat, so click until one lands.
  await expect(async () => {
    await expect(page.locator("#score-frame")).toHaveAttribute("data-rendered-version", "1");
    if ((await mark.count()) === 0) await page.mouse.click(system.x + system.width * 0.3, system.y + system.height * 0.75);
    await expect(mark).toHaveCount(1, { timeout: 500 });
  }).toPass({ timeout: 15_000 });
  const state = await page.locator("#state").textContent();
  const beat = /beat (\d+) of track 0 → kept at beat (\d+)/.exec(state ?? "");
  expect(beat?.[1]).toBe(beat?.[2]);
  const placed = await mark.evaluate((node: HTMLElement) => [node.style.left, node.style.top]);

  await page.setInputFiles("#gp-revision", GP_FILE);
  await page.locator("#score-frame").scrollIntoViewIfNeeded();
  await expect(page.locator("#score-frame")).toHaveAttribute("data-rendered-version", "2", { timeout: 15_000 });
  await expect(mark).toHaveAttribute("data-state", "kept");
  expect(await mark.evaluate((node: HTMLElement) => [node.style.left, node.style.top])).toEqual(placed);
});

// ---------------------------------------------------------------------------

function item(page: Page, text: string | RegExp): Locator {
  return page.locator("#chart .item", { has: page.locator(".lyric", { hasText: text }) });
}

/** The non-empty chords on the line that holds `item`, as drawn. */
async function lineChords(item: Locator): Promise<Array<string>> {
  return item.evaluate((node) =>
    [...node.parentElement!.querySelectorAll(".chord")].map((chord) => chord.textContent ?? "").filter(Boolean),
  );
}

async function target(locator: Locator): Promise<string | null> {
  return locator.evaluate((node: HTMLElement) => `${node.dataset.line}:${node.dataset.item}`);
}

async function placeText(page: Page, target: Locator, text: string): Promise<Locator> {
  await page.check('input[value="text"]');
  await page.fill("#text-input", text);
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  await page.mouse.click(box.x + 3, box.y + 2);
  await page.check('input[value="move"]');
  return page.locator(".mark.text", { hasText: text });
}

/** The mark is drawn at the target item's top-left (where it was clicked), with the given state. */
async function expectOn(mark: Locator, targetItem: Locator, state?: "kept" | "changed") {
  await expect(mark).toHaveAttribute("data-target", (await target(targetItem))!);
  if (state) await expect(mark).toHaveAttribute("data-state", state);
  // Marks are redrawn on every resize, so read both boxes until they settle.
  await expect
    .poll(async () => {
      const m = await mark.boundingBox();
      const t = await targetItem.boundingBox();
      return m && t ? Math.max(Math.abs(m.x - (t.x + 3)), Math.abs(m.y - (t.y + 2))) : Infinity;
    })
    .toBeLessThan(2);
}

/** Either drawn on its own item, or orphaned to the tray. Never on another item. */
async function expectOnOrTray(page: Page, mark: Locator, target: Locator) {
  if ((await mark.count()) === 0) {
    await expect(page.locator("#tray li")).toHaveCount(1);
    return;
  }
  await expectOn(mark, target);
}

async function editSource(page: Page, text: string, button: string) {
  await page.fill("#source", text);
  await page.click(button);
}

async function drag(page: Page, ...points: Array<[number, number]>) {
  await page.mouse.move(...points[0]!);
  await page.mouse.down();
  for (const point of points.slice(1)) await page.mouse.move(...point, { steps: 6 });
  await page.mouse.up();
}
