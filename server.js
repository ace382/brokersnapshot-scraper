import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json());

app.get("/", (req, res) => {
  res.send("BrokerSnapshot scraper is running");
});

app.post("/brokersnapshot", async (req, res) => {
  const { mcNumber } = req.body;

  if (!mcNumber) {
    return res.status(400).json({ error: "Missing mcNumber" });
  }

  let browser;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage"]
    });

    const page = await browser.newPage({
      viewport: { width: 1400, height: 1000 }
    });

    const searchUrl = `https://brokersnapshot.com/?search=${encodeURIComponent(mcNumber)}`;

    await page.goto(searchUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    await page.waitForTimeout(7000);

    const possibleMcLinks = [
      `a:has-text("MC${mcNumber}")`,
      `a:has-text("${mcNumber}")`
    ];

    let clickedProfile = false;

    for (const selector of possibleMcLinks) {
      const locator = page.locator(selector).first();

      if (await locator.count()) {
        await Promise.all([
          page.waitForLoadState("networkidle").catch(() => {}),
          locator.click()
        ]);

        clickedProfile = true;
        await page.waitForTimeout(7000);
        break;
      }
    }

    const text = await page.locator("body").innerText().catch(() => "");
    const html = await page.content().catch(() => "");
    const title = await page.title();
    const finalUrl = page.url();

    function findField(labels) {
      for (const label of labels) {
        const regex = new RegExp(`${label}\\s*[:\\-]?\\s*([^\\n]+)`, "i");
        const match = text.match(regex);
        if (match && match[1]) {
          return match[1].trim();
        }
      }
      return null;
    }

    const result = {
      mcNumber,
      usDot: findField(["US DOT", "DOT"]),
      legalName: findField(["Legal Name", "Company Name"]),
      businessAddress: findField(["Business Address", "Physical Address", "Address"]),
      commonAuthorityStatus: findField(["Common Authority Status", "Authority Status", "Operating Status"]),
      bipdInsuranceRequired: findField(["BIPD Insurance Required", "Insurance Required"]),
      bipdInsuranceOnFile: findField(["BIPD Insurance on File", "Insurance on File"]),
      pendingInsuranceCancellation: /pending insurance cancellation|pending cancellation/i.test(text) ? "Yes" : "No",
      insuranceEffectiveDate: findField(["Insurance Effective Date", "Effective Date"]),
      source: "BrokerSnapshot",
      debug: {
        searchUrl,
        finalUrl,
        title,
        clickedProfile,
        asksForLogin: text.includes("Please log in"),
        hasCaptcha: /captcha|cloudflare|cf_clearance|checking your browser/i.test(html),
        textPreview: text.slice(0, 1500)
      }
    };

    await browser.close();
    return res.json(result);
  } catch (error) {
    if (browser) {
      await browser.close().catch(() => {});
    }

    return res.status(500).json({
      mcNumber,
      source: "BrokerSnapshot",
      error: error.message
    });
  }
});

const port = process.env.PORT || 10000;

app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
});
