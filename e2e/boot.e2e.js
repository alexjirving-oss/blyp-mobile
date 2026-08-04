describe("Blyp E2E scaffold", () => {
  beforeAll(async () => { await device.launchApp({ newInstance: true }); });
  it("boots", async () => {
    await expect(element(by.id("ROOT_APP"))).toBeVisible();
  });
});
