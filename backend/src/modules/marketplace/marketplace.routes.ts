import { Router } from "express";
import browseRoutes from "./marketplace-browse.routes.js";
import favoritesRoutes from "./marketplace-favorites.routes.js";
import productRoutes from "./marketplace-products.routes.js";

const router = Router();

router.use(browseRoutes);
router.use(favoritesRoutes);
router.use(productRoutes);

export default router;
