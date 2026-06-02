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

    const page = await browser.newPage();

    await page.goto("https://brokersnapshot.com/", {
      waitUntil: "domcontentloaded",
      timeout: 60000
    });

    // Search MC number
    await page.fill('input[type="search"], input[type="text"], input', String(mcNumber));

    await Promise.all([
      page.waitForLoadState("networkidle").catch(() => {}),
      page.keyboard.press("Enter")
    ]);

    await page.waitForTimeout(5000);

    // Try clicking MC link if present
    const mcLink = page.locator(`a:has-text("MC${mcNumber}")`).first();

    if (await mcLink.count()) {
      await Promise.all([
        page.waitForLoadState("networkidle").catch(() => {}),
        mcLink.click()
      ]);

      await page.waitForTimeout(5000);
    }

    const text = await page.locator("body").innerText();
    const title = await page.title();
    const finalUrl = page.url();

    function findField(labels) {
      for (const label of labels) {
        const regex = new RegExp(`${label}\\s*[:\\-]?\\s*([^\\n]+)`, "i");
        const match = text.match(regex);
        if (match?.[1]) return match[1].trim();
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
        title,
        finalUrl,
        textPreview: text.slice(0, 1000),
        loggedInWarning: text.includes("Please log in") ? "BrokerSnapshot is asking for login" : null
      }
    };

    await browser.close();
    return res.json(result);

  } catch (error) {
    if (browser) await browser.close();

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
