import { Router } from "express";
import { requireApiKey } from "../middleware/apiKeyAuth.js";
import { getAllRates, getRateByCode } from "../db/index.js";

const router = Router();
router.use(requireApiKey);

router.get("/rates", async (req, res, next) => {
  try {
    const rates = await getAllRates();
    const { region, tag } = req.query;
    const filtered = rates.filter((r) =>
      (!region || r.region.toLowerCase() === String(region).toLowerCase()) &&
      (!tag || r.tags.includes(String(tag).toUpperCase()))
    );
    res.json({ count: filtered.length, rates: filtered });
  } catch (err) {
    next(err);
  }
});

router.get("/rates/:code", async (req, res, next) => {
  try {
    const rate = await getRateByCode(req.params.code);
    if (!rate) return res.status(404).json({ error: `No data for country code ${req.params.code}` });
    res.json(rate);
  } catch (err) {
    next(err);
  }
});

export default router;
