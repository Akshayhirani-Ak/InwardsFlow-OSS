import { test, expect } from '@playwright/test';

// Phase 10 smoke tests — public behaviour only, no credentials, no real data.
test.describe('InwardsFlow smoke', () => {
  test('login page renders the sign-in form', async ({ page }) => {
    const res = await page.goto('/login');
    expect(res?.status()).toBe(200);
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('protected dashboard redirects anonymous users to login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
  });

  test('AI intake endpoint refuses anonymous calls', async ({ request }) => {
    const res = await request.post('/api/ai-intake', { data: {} });
    expect(res.status()).toBe(401);
  });

  test('pallet slip route is behind auth', async ({ page }) => {
    await page.goto('/print/pallet/00000000-0000-0000-0000-000000000000');
    await expect(page).toHaveURL(/\/login/);
  });
});
