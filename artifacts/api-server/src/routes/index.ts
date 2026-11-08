import { Router, type IRouter } from "express";
import healthRouter from "./health";
import revelaRouter from "./revela";
import storageRouter from "./storage";

const router: IRouter = Router();

router.use(healthRouter);
router.use(revelaRouter);
router.use(storageRouter);

export default router;
