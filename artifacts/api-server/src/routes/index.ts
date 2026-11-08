import { Router, type IRouter } from "express";
import healthRouter from "./health";
import revelaRouter from "./revela";

const router: IRouter = Router();

router.use(healthRouter);
router.use(revelaRouter);

export default router;
