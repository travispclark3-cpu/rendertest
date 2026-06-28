import { Router, type IRouter } from "express";
import healthRouter from "./health";
import liveStreamsRouter from "./live-streams";
import tickerRouter from "./ticker";
import chartRouter from "./chart";

const router: IRouter = Router();

router.use(healthRouter);
router.use(liveStreamsRouter);
router.use(tickerRouter);
router.use(chartRouter);

export default router;
