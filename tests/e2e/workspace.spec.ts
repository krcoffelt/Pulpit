import { expect, test } from "@playwright/test";

test.beforeEach(async ({ request, context }) => {
  const email = "browser-tests@circumvision.test";
  expect((await request.post("/api/session", { data: { email } })).status()).toBe(200);
  expect((await context.request.post("/api/session", { data: { email } })).status()).toBe(200);
});

test("any email opens the workspace immediately and remains signed in", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Enter your email. That's it." })).toBeVisible();
  await page.getByLabel("Email").fill("Anybody@Example.com");
  await page.getByRole("button", { name: "Enter Circumvision" }).click();
  await expect(page.getByText("Trim the sermon.").or(page.getByRole("heading", { name: "Projects" }))).toBeVisible();
  await page.reload();
  await expect(page.getByText("Trim the sermon.").or(page.getByRole("heading", { name: "Projects" }))).toBeVisible();
  await expect(page.getByRole("button", { name: "Enter Circumvision" })).toHaveCount(0);
});

test("creates, resumes, and deletes a sectioned project through protected APIs", async ({ request }) => {
  const source = Buffer.alloc(256);
  source.writeUInt32BE(24, 0);
  source.write("ftypisom", 4, "ascii");
  const created = await request.post("/api/projects", { data: { title: "E2E Sermon", fileName: "e2e.mp4", fileType: "video/mp4", fileSize: source.byteLength, totalParts: 1, targetDuration: 30 } });
  expect(created.status()).toBe(201);
  const { project } = await created.json();

  try {
    const uploaded = await request.post("/api/uploads", {
      data: source,
      headers: { "Content-Type": "application/octet-stream", "x-project-id": project.id, "x-chunk-index": "0", "x-total-chunks": "1" },
    });
    expect(uploaded.status()).toBe(200);
    const restored = await request.get(`/api/projects/${project.id}`);
    expect((await restored.json()).project.source.uploadedParts).toEqual([0]);
    const media = await request.get(`/api/projects/${project.id}/media`, { headers: { Range: "bytes=0-255" } });
    expect(media.status()).toBe(206);
    expect(await media.body()).toEqual(source);
  } finally {
    expect((await request.delete(`/api/projects/${project.id}`)).status()).toBe(200);
  }
});

test("pauses an interrupted upload without losing completed sections", async ({ request }) => {
  const created = await request.post("/api/projects", { data: { title: "Paused upload", fileName: "paused.mp4", fileType: "video/mp4", fileSize: 3 * 1024 * 1024 + 1, totalParts: 2, targetDuration: 30 } });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  try {
    const first = Buffer.alloc(3 * 1024 * 1024);
    first.writeUInt32BE(24, 0);
    first.write("ftypisom", 4, "ascii");
    expect((await request.post("/api/uploads", {
      data: first,
      headers: { "Content-Type": "application/octet-stream", "x-project-id": project.id, "x-chunk-index": "0", "x-total-chunks": "2" },
    })).status()).toBe(200);
    const cancelled = await request.post(`/api/projects/${project.id}/cancel`);
    expect(cancelled.status()).toBe(200);
    const payload = await cancelled.json();
    expect(payload.project.status).toBe("uploading");
    expect(payload.project.stage).toContain("resume");
    expect(payload.project.source.uploadedParts).toEqual([0]);
    expect((await request.post("/api/uploads", {
      data: Buffer.from([0]),
      headers: { "Content-Type": "application/octet-stream", "x-project-id": project.id, "x-chunk-index": "1", "x-total-chunks": "2" },
    })).status()).toBe(200);
    expect((await (await request.get(`/api/projects/${project.id}`)).json()).project.source.uploadedParts).toEqual([0, 1]);
  } finally {
    await request.delete(`/api/projects/${project.id}`);
  }
});

test("project dashboard survives refresh and return-later navigation", async ({ page, request }, testInfo) => {
  const title = `Refresh-safe ${testInfo.project.name}`;
  const created = await request.post("/api/projects", { data: { title, fileName: "refresh.mp4", fileType: "video/mp4", fileSize: 256, totalParts: 1, targetDuration: 30 } });
  const { project } = await created.json();
  try {
    await page.goto("/");
    await expect(page.getByText(title)).toBeVisible();
    await page.reload();
    await expect(page.getByText(title)).toBeVisible();
  } finally {
    await request.delete(`/api/projects/${project.id}`);
  }
});

test("health probe is structured and cross-site mutations are rejected", async ({ request }) => {
  const health = await request.get("/api/health");
  expect([200, 503]).toContain(health.status());
  await expect(health.json()).resolves.toMatchObject({ status: expect.any(String), requestId: expect.any(String), checks: expect.any(Object) });

  const rejected = await request.post("/api/projects", {
    headers: { Origin: "https://malicious.example" },
    data: { title: "Blocked", fileName: "blocked.mp4", fileType: "video/mp4", fileSize: 100, totalParts: 1, targetDuration: 30 },
  });
  expect(rejected.status()).toBe(403);
});

test("dashboard and upload workspace have no broken controls or horizontal overflow", async ({ page, isMobile }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projects" }).or(page.getByText("Trim the sermon."))).toBeVisible();
  const newButton = page.getByRole("button", { name: "New sermon" });
  if (await newButton.count()) {
    await expect(newButton).toBeVisible();
    await newButton.click();
  }
  await expect(page.getByRole("button", { name: /Choose or drop a sermon/ })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `${isMobile ? "mobile" : "desktop"} horizontal overflow`).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test("desktop primary actions are clear and comfortably clickable", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop-only usability check");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projects" }).or(page.getByText("Trim the sermon."))).toBeVisible();
  const newButton = page.getByRole("button", { name: "New sermon" });
  if (await newButton.count()) await newButton.click();

  const upload = page.getByRole("button", { name: "Choose or drop a sermon" });
  const sample = page.getByRole("button", { name: "Try the sample" });
  await expect(upload).toBeVisible();
  await expect(sample).toBeVisible();
  await expect(upload).toHaveJSProperty("disabled", false);
  expect((await sample.boundingBox())?.height).toBeGreaterThanOrEqual(44);

  await sample.click();
  await expect(page.getByRole("button", { name: "Export" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Projects" })).toBeVisible();

  const criticalControls = page.locator(".editor-header button, .inspector-tabs button, .aspect-switcher button, .canvas-fit, .add-clip, .player-right button");
  const sizes = await criticalControls.evaluateAll((buttons) => buttons.filter((button) => {
    const style = getComputedStyle(button);
    return style.display !== "none" && style.visibility !== "hidden";
  }).map((button) => ({ label: button.textContent?.trim() || button.getAttribute("aria-label") || "button", height: button.getBoundingClientRect().height })));
  expect(sizes.length).toBeGreaterThan(8);
  for (const control of sizes) expect(control.height, `${control.label} click target`).toBeGreaterThanOrEqual(40);
});

test("editing tools remain available at mobile width", async ({ page, isMobile }) => {
  test.skip(!isMobile, "mobile-only interaction");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Projects" }).or(page.getByText("Trim the sermon."))).toBeVisible();
  const newButton = page.getByRole("button", { name: "New sermon" });
  if (await newButton.count()) await newButton.click();
  await page.getByRole("button", { name: /Try the sample/ }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await expect(page.getByRole("button", { name: "Close editing tools" }).last()).toBeVisible();
  await expect(page.getByRole("button", { name: /9:16/ }).last()).toBeVisible();
});

test("legacy large-body endpoints return readable JSON", async ({ request }) => {
  for (const endpoint of ["/api/analyze", "/api/render"]) {
    const response = await request.post(endpoint);
    expect(response.status()).toBe(410);
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String), requestId: expect.any(String) });
  }
});
