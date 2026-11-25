import { expect, test, type Page } from '@playwright/test';

import { loadState } from '../utils';

/*
  End-to-end coverage for the sailing consistency requirements:
  - heading changes update the fleet direction indicator and speed
  - crossing a summer/winter boundary updates the wind indicator
  - supplying cargo in harbor and setting sail reflects it in provisions/speed
  Math.random is pinned so wind generation is deterministic.
 */

const ship = (water: number, food: number) => ({
  id: '22',
  name: 'Test ship',
  crew: 30,
  cargo: [
    { type: 'water' as const, quantity: water },
    { type: 'food' as const, quantity: food },
  ],
  durability: 60,
});

const captainMate = [{ sailorId: '1', role: 0 as const }];

// first 20-grid tick inside winter, mirroring getIsSummer(START_DATE, …)
const startDate = new Date(1522, 4, 17);
const isSummer = (timePassed: number) => {
  const date = new Date(startDate);
  date.setMinutes(date.getMinutes() + timePassed);
  const month = date.getMonth();
  return month >= 3 && month < 9;
};
let winterBoundary = 190000;
while (isSummer(winterBoundary)) {
  winterBoundary += 20;
}

const windSpeed = (page: Page) =>
  page.locator(
    "xpath=//div[normalize-space(text())='Wind']/following-sibling::div/div[contains(@class,'text-right')]",
  );

const windDirection = (page: Page) =>
  page.locator(
    "xpath=//div[normalize-space(text())='Wind']/following-sibling::div/img",
  );

const fleetSpeed = (page: Page) =>
  page.locator(
    "xpath=//div[normalize-space(text())='Your fleet']/following-sibling::div/div[contains(@class,'text-right')]/div[1]",
  );

const fleetDirection = (page: Page) =>
  page.locator(
    "xpath=//div[normalize-space(text())='Your fleet']/following-sibling::div/img",
  );

const provisions = (page: Page, name: string) =>
  page.locator(`img[alt="${name}"] + div`);

const pinRandom = async (page: Page) => {
  await page.addInitScript(() => {
    Math.random = () => 0;
  });
};

const readKnots = async (page: Page) =>
  expect
    .poll(
      async () => {
        const text = (await fleetSpeed(page).textContent()) || '';
        return text.trim();
      },
      {
        timeout: 10000,
        message: 'fleet speed should become a non-zero integer',
      },
    )
    .toMatch(/^[1-9]\d*$/);

test.describe('Sailing indicators', () => {
  test.beforeEach(async ({ page }) => {
    await pinRandom(page);
  });

  test('fleet direction and speed follow heading changes, with zero without heading', async ({
    page,
  }) => {
    await loadState(page, {
      portId: null,
      buildingId: null,
      timePassed: 460,
      gold: 100000,
      fleets: {
        1: { position: { x: 840, y: 356 }, ships: [ship(50, 50)] },
      },
      mates: captainMate,
    });

    await expect(windSpeed(page)).toHaveText(/^\d+$/, { timeout: 10000 });
    await expect(fleetSpeed(page)).toHaveText('0');

    await page.keyboard.down('d');
    await readKnots(page);
    const knotsEast = (await fleetSpeed(page).textContent())!.trim();
    const directionEast = await fleetDirection(page).getAttribute('src');

    // no state changes: the cached speed/indicator stays stable
    await expect(fleetSpeed(page)).toHaveText(knotsEast);

    await page.keyboard.up('d');
    await page.keyboard.down('s');
    await expect
      .poll(async () => fleetDirection(page).getAttribute('src'))
      .not.toBe(directionEast);
    await expect(fleetSpeed(page)).toHaveText(/^\d+$/);
    await page.keyboard.up('s');
  });

  test('wind indicator updates once summer changes to winter', async ({
    page,
  }) => {
    await loadState(page, {
      portId: null,
      buildingId: null,
      // 260 minutes before the winter boundary: the first tick renders the
      // summer wind for sea area 0 (speed 1 with pinned random), then the
      // boundary tick switches to winter wind (speed 3).
      timePassed: winterBoundary - 260,
      gold: 0,
      fleets: { 1: { position: { x: 0, y: 0 }, ships: [ship(50, 50)] } },
      mates: captainMate,
    });

    await expect(windSpeed(page)).toHaveText('1', { timeout: 15000 });
    const summerDirection = await windDirection(page).getAttribute('src');

    await expect(windSpeed(page)).toHaveText('3', { timeout: 15000 });
    await expect
      .poll(async () => windDirection(page).getAttribute('src'))
      .not.toBe(summerDirection);
  });

  test.describe('after supplying in harbor', () => {
    test.describe.configure({ mode: 'serial' });

    let knotsModestCargo = '';

    test('sets sail with provisions indicator matching cargo', async ({
      page,
    }) => {
      await loadState(page, {
        portId: '2',
        buildingId: '4',
        timePassed: 480,
        gold: 100000,
        fleets: { 1: { position: undefined, ships: [ship(50, 50)] } },
        mates: captainMate,
      });

      await page.locator('[data-test=menu]').getByText('Sail').first().click();
      await page.locator('[data-test=confirmYes]').click();

      await expect(provisions(page, 'Water')).toHaveText('50');
      await page.keyboard.down('d');
      await readKnots(page);
      knotsModestCargo = (await fleetSpeed(page).textContent())!.trim();
      expect(Number(knotsModestCargo)).toBeGreaterThan(0);
      await page.keyboard.up('d');
    });

    test('loading the ship to capacity lowers speed and updates provisions', async ({
      page,
    }) => {
      test.skip(!knotsModestCargo, 'requires the modest-cargo reading');

      await loadState(page, {
        portId: '2',
        buildingId: '4',
        timePassed: 480,
        gold: 100000,
        fleets: { 1: { position: undefined, ships: [ship(50, 50)] } },
        mates: captainMate,
      });

      await page
        .locator('[data-test=menu]')
        .getByText('Supply')
        .first()
        .click();
      const supply = page.locator('[data-test=harborSupply]');
      await supply.getByText('50').first().click();
      await page
        .locator('[data-test=inputNumberInput]')
        .pressSequentially('320');
      await page.keyboard.press('Enter');
      await expect(supply).toContainText('370');

      // back to the harbor menu, then sail
      await page.locator('[data-test=building]').click({ button: 'right' });
      await page.locator('[data-test=menu]').getByText('Sail').first().click();
      await page.locator('[data-test=confirmYes]').click();

      await expect(provisions(page, 'Water')).toHaveText('370');

      await page.keyboard.down('d');
      await readKnots(page);
      const knotsFullCargo = (await fleetSpeed(page).textContent())!.trim();
      await page.keyboard.up('d');

      expect(Number(knotsFullCargo)).toBeLessThan(Number(knotsModestCargo));
    });
  });
});
